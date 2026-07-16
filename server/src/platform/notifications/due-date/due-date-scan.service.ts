import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument } from '../../tenant/schemas/tenant.schema';
import { NotificationsService } from '../notifications.service';
import { DueDateScanRun, DueDateScanRunDocument } from '../schemas/due-date-scan-run.schema';
import { DueDateScannerRegistry } from './due-date-scanner.registry';

export interface DueDateScanSummary {
  tenantsScanned: number;
  runsCompleted: number;
  runsSkipped: number;
  notificationsCreated: number;
}

const MONGO_DUPLICATE_KEY = 11000;

// PLT-6: the generic due-date scanner framework (SPEC.md §6 background jobs; consumers: DOC-6,
// TRN-5, EQP-4, EQP-9). One daily BullMQ job calls runDailyScan(); every registered scanner runs
// once per tenant per tenant-timezone calendar day, and findings become deduped notifications.
@Injectable()
export class DueDateScanService {
  private readonly logger = new Logger(DueDateScanService.name);

  constructor(
    private readonly registry: DueDateScannerRegistry,
    private readonly notificationsService: NotificationsService,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(DueDateScanRun.name) private readonly scanRunModel: Model<DueDateScanRunDocument>,
  ) {}

  // Idempotent: a completed (tenant, scanner, runDate) is never re-run, and even if two runs
  // race past that check, per-finding dedupeKeys make duplicate notifications impossible and the
  // unique index lets only one scan-run record land.
  async runDailyScan(now: Date = new Date()): Promise<DueDateScanSummary> {
    const summary: DueDateScanSummary = {
      tenantsScanned: 0,
      runsCompleted: 0,
      runsSkipped: 0,
      notificationsCreated: 0,
    };

    const tenants = await this.tenantModel.find({ isActive: true });
    const scanners = this.registry.getAll();

    for (const tenant of tenants) {
      summary.tenantsScanned += 1;
      const tenantId = tenant._id.toString();
      const runDate = formatDateInTimezone(now, tenant.settings.timezone);

      for (const scanner of scanners) {
        const alreadyRan = await this.scanRunModel.exists({ tenantId, scannerKey: scanner.key, runDate });
        if (alreadyRan) {
          summary.runsSkipped += 1;
          continue;
        }

        const findings = await scanner.scan({ tenantId, runDate, now });

        let created = 0;
        for (const finding of findings) {
          const notification = await this.notificationsService.notify({
            tenantId,
            userId: finding.userId,
            event: finding.event,
            entityType: finding.entityType,
            entityId: finding.entityId,
            title: finding.title,
            body: finding.body,
            dedupeKey: finding.dedupeKey,
            actor: null, // system-generated
            whatsapp: finding.whatsapp,
          });
          if (notification) {
            created += 1;
          }
        }

        try {
          await this.scanRunModel.create({
            tenantId,
            scannerKey: scanner.key,
            runDate,
            notificationsCreated: created,
            completedAt: new Date(),
          });
          summary.runsCompleted += 1;
          summary.notificationsCreated += created;
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            // A concurrent run recorded completion first — its notifications and ours were
            // deduped against each other, so nothing was double-sent.
            summary.runsSkipped += 1;
          } else {
            throw error;
          }
        }
      }
    }

    this.logger.log(
      `Due-date scan: ${summary.tenantsScanned} tenants, ${summary.runsCompleted} runs, ` +
        `${summary.runsSkipped} skipped, ${summary.notificationsCreated} notifications`,
    );
    return summary;
  }
}

// SPEC.md §5.4: store/compute UTC, present in tenant timezone — the "day" a scan belongs to is a
// tenant-local concept. en-CA formats as YYYY-MM-DD directly.
export function formatDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
