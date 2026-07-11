import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditAction, type AuditEventData } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { diffObjects } from './audit-diff.util';
import { AuditEvent, AuditEventDocument } from './schemas/audit-event.schema';

export interface RecordAuditEventInput {
  tenantId: string;
  // null only for the rare system-initiated event with no human actor.
  actor: { userId: string; fullName: string } | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

export interface AuditHistoryPage {
  items: AuditEventData[];
  total: number;
}

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditEvent.name) private readonly auditEventModel: Model<AuditEventDocument>) {}

  // PLT-2: the ONE writer of auditEvents (Iron Rule 1). Prefer the @Audited() decorator +
  // AuditTrailInterceptor for authenticated controller actions; call this directly only at
  // boundaries the interceptor structurally cannot reach (see AuthService's login/lockout calls).
  async record(input: RecordAuditEventInput): Promise<void> {
    const changes = diffObjects(input.before ?? null, input.after ?? null);
    await this.auditEventModel.create({
      tenantId: input.tenantId,
      actorId: input.actor?.userId ?? null,
      actorName: input.actor?.fullName ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      changes,
      reason: input.reason ?? null,
      occurredAt: new Date(),
    });
  }

  async findHistory(
    tenantId: string,
    entityType: string,
    entityId: string,
    page: number,
    limit: number,
  ): Promise<AuditHistoryPage> {
    const filter = { tenantId, entityType, entityId };
    const [docs, total] = await Promise.all([
      this.auditEventModel
        .find(filter)
        .sort({ occurredAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.auditEventModel.countDocuments(filter),
    ]);
    return { items: docs.map(toAuditEventData), total };
  }

  // Unpaginated — feeds the CSV export endpoints (SPEC.md §5.5), not a UI list.
  async findAllForRecord(tenantId: string, entityType: string, entityId: string): Promise<AuditEventData[]> {
    const docs = await this.auditEventModel.find({ tenantId, entityType, entityId }).sort({ occurredAt: -1 }).lean();
    return docs.map(toAuditEventData);
  }

  async findAllForModule(tenantId: string, entityType: string): Promise<AuditEventData[]> {
    const docs = await this.auditEventModel.find({ tenantId, entityType }).sort({ occurredAt: -1 }).lean();
    return docs.map(toAuditEventData);
  }
}

function toAuditEventData(doc: {
  _id: unknown;
  tenantId: unknown;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  changes: AuditEventData['changes'];
  reason: string | null;
  occurredAt: Date;
}): AuditEventData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    actorId: doc.actorId,
    actorName: doc.actorName,
    entityType: doc.entityType,
    entityId: doc.entityId,
    action: doc.action,
    changes: doc.changes,
    reason: doc.reason,
    occurredAt: doc.occurredAt.toISOString(),
  };
}
