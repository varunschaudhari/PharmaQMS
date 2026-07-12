import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEvent } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../audit/schemas/audit-event.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { DueDateScanService, formatDateInTimezone } from '../due-date/due-date-scan.service';
import { DueDateScannerRegistry } from '../due-date/due-date-scanner.registry';
import type { DueDateFinding, DueDateScanner } from '../due-date/due-date-scanner.interface';
import { NOTIFICATION_JOBS } from '../jobs/notification-jobs.interface';
import { NotificationsService } from '../notifications.service';
import { Notification, NotificationDocument, NotificationSchema } from '../schemas/notification.schema';
import { DueDateScanRun, DueDateScanRunDocument, DueDateScanRunSchema } from '../schemas/due-date-scan-run.schema';

describe('PLT-6 due-date scanner framework', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let registry: DueDateScannerRegistry;
  let scanService: DueDateScanService;
  let notificationModel: Model<NotificationDocument>;
  let scanRunModel: Model<DueDateScanRunDocument>;
  let tenantModel: Model<TenantDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
          { name: DueDateScanRun.name, schema: DueDateScanRunSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
        ]),
      ],
      providers: [
        DueDateScannerRegistry,
        DueDateScanService,
        NotificationsService,
        AuditService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail: jest.fn() } },
      ],
    }).compile();

    registry = moduleRef.get(DueDateScannerRegistry);
    scanService = moduleRef.get(DueDateScanService);
    notificationModel = moduleRef.get(getModelToken(Notification.name));
    scanRunModel = moduleRef.get(getModelToken(DueDateScanRun.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    await notificationModel.init();
    await scanRunModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await notificationModel.collection.deleteMany({});
    await scanRunModel.collection.deleteMany({});
    await tenantModel.collection.deleteMany({});
    // Fresh registry state per test — the registry itself has no reset API by design.
    (registry as unknown as { scanners: Map<string, DueDateScanner> }).scanners.clear();
  });

  function makeScanner(key: string, findings: DueDateFinding[] | ((tenantId: string) => DueDateFinding[])) {
    const scan = jest.fn(async (context: { tenantId: string }) =>
      typeof findings === 'function' ? findings(context.tenantId) : findings,
    );
    const scanner: DueDateScanner = { key, scan };
    return { scanner, scan };
  }

  function calibrationFinding(userId: string, entityId: string): DueDateFinding {
    return {
      userId,
      event: NotificationEvent.DUE_SOON,
      entityType: 'Equipment',
      entityId,
      title: `Calibration due soon: ${entityId}`,
      body: `${entityId} is due for calibration on 2026-08-01.`,
      dedupeKey: `due_soon:Equipment:${entityId}:calibration:2026-08-01`,
    };
  }

  it('PLT-6: scanners register into the framework; a duplicate key is rejected', () => {
    const { scanner } = makeScanner('equipment.calibration-due', []);
    registry.register(scanner);
    expect(registry.getAll()).toHaveLength(1);

    const { scanner: duplicate } = makeScanner('equipment.calibration-due', []);
    expect(() => registry.register(duplicate)).toThrow(/already registered/);

    const { scanner: other } = makeScanner('documents.periodic-review', []);
    registry.register(other);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('PLT-6: the daily run turns scanner findings into notifications and records one scan-run per tenant/scanner/day', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-scan-1' });
    const userId = new mongoose.Types.ObjectId().toString();
    const { scanner, scan } = makeScanner('equipment.calibration-due', [calibrationFinding(userId, 'EQP-0042')]);
    registry.register(scanner);

    const summary = await scanService.runDailyScan(new Date('2026-07-11T05:00:00.000Z'));

    expect(summary.tenantsScanned).toBe(1);
    expect(summary.runsCompleted).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenant._id.toString(), runDate: '2026-07-11' }),
    );

    const notifications = await notificationModel.find({ tenantId: tenant._id });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].event).toBe(NotificationEvent.DUE_SOON);

    const runs = await scanRunModel.find({ tenantId: tenant._id });
    expect(runs).toHaveLength(1);
    expect(runs[0].scannerKey).toBe('equipment.calibration-due');
    expect(runs[0].notificationsCreated).toBe(1);
  });

  it('PLT-6: re-running the scan on the same day is idempotent — the scanner is not called again and nothing new is created', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-scan-2' });
    const userId = new mongoose.Types.ObjectId().toString();
    const { scanner, scan } = makeScanner('equipment.calibration-due', [calibrationFinding(userId, 'EQP-0042')]);
    registry.register(scanner);

    const now = new Date('2026-07-11T05:00:00.000Z');
    await scanService.runDailyScan(now);
    const secondRun = await scanService.runDailyScan(now);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(secondRun.runsCompleted).toBe(0);
    expect(secondRun.runsSkipped).toBe(1);
    expect(secondRun.notificationsCreated).toBe(0);
    expect(await notificationModel.countDocuments({ tenantId: tenant._id })).toBe(1);
    expect(await scanRunModel.countDocuments({ tenantId: tenant._id })).toBe(1);
  });

  it('PLT-6: the next day the scanner runs again, but stable dedupeKeys still prevent duplicate notifications for the same fact', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-scan-3' });
    const userId = new mongoose.Types.ObjectId().toString();
    const { scanner, scan } = makeScanner('equipment.calibration-due', [calibrationFinding(userId, 'EQP-0042')]);
    registry.register(scanner);

    await scanService.runDailyScan(new Date('2026-07-11T05:00:00.000Z'));
    const nextDay = await scanService.runDailyScan(new Date('2026-07-12T05:00:00.000Z'));

    expect(scan).toHaveBeenCalledTimes(2);
    expect(nextDay.runsCompleted).toBe(1);
    // The finding was re-reported but its dedupeKey already exists — no duplicate notification.
    expect(nextDay.notificationsCreated).toBe(0);
    expect(await notificationModel.countDocuments({ tenantId: tenant._id })).toBe(1);
    expect(await scanRunModel.countDocuments({ tenantId: tenant._id })).toBe(2);
  });

  it('PLT-6: each tenant is scanned separately, and the run date follows the TENANT timezone', async () => {
    const istTenant = await tenantModel.create({ name: 'IST Plant', slug: 'ist-plant' });
    const utcTenant = await tenantModel.create({
      name: 'UTC Plant',
      slug: 'utc-plant',
      settings: { timezone: 'UTC' },
    });
    const { scanner, scan } = makeScanner('documents.periodic-review', (tenantId) => [
      {
        userId: new mongoose.Types.ObjectId().toString(),
        event: NotificationEvent.OVERDUE,
        entityType: 'Document',
        entityId: `SOP-${tenantId.slice(-4)}`,
        title: 'Review overdue',
        body: 'Periodic review overdue.',
        dedupeKey: `overdue:Document:${tenantId}`,
      },
    ]);
    registry.register(scanner);

    // 20:00 UTC = next day 01:30 in Asia/Kolkata.
    await scanService.runDailyScan(new Date('2026-07-11T20:00:00.000Z'));

    const istRun = await scanRunModel.findOne({ tenantId: istTenant._id });
    const utcRun = await scanRunModel.findOne({ tenantId: utcTenant._id });
    expect(istRun!.runDate).toBe('2026-07-12');
    expect(utcRun!.runDate).toBe('2026-07-11');
    expect(scan).toHaveBeenCalledTimes(2);

    // Each tenant got its own notification, scoped to its own tenantId.
    expect(await notificationModel.countDocuments({ tenantId: istTenant._id })).toBe(1);
    expect(await notificationModel.countDocuments({ tenantId: utcTenant._id })).toBe(1);
  });

  it('PLT-6: formatDateInTimezone renders the tenant-local calendar day', () => {
    const instant = new Date('2026-07-11T20:00:00.000Z');
    expect(formatDateInTimezone(instant, 'Asia/Kolkata')).toBe('2026-07-12');
    expect(formatDateInTimezone(instant, 'UTC')).toBe('2026-07-11');
  });
});
