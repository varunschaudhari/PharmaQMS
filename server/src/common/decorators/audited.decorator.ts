import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@pharmaqms/shared';

export const AUDITED_KEY = 'audited';

export interface AuditedOptions {
  entityType: string;
  action: AuditAction;
}

// The contract a handler decorated with @Audited() must attach to its returned response so
// AuditTrailInterceptor can record the event (actor/tenant come from the authenticated request).
// PLT-4: entityType/action are static at most call sites (e.g. always 'User'/CREATE), but a
// generic engine like the workflow one attaches to a caller-specified entity type, and one
// action-taking endpoint can result in different audit actions per branch (approve vs the final
// step's approve vs reject vs reassign) — entityType/action here override the decorator's static
// defaults when present.
export interface AuditPayload {
  entityId: string;
  entityType?: string;
  action?: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

// PLT-2: declarative opt-in for AuditTrailInterceptor. The decorated handler must return
// { data, audit?: AuditPayload } — the interceptor records the audit event and strips `audit`
// before the response is sent to the client.
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED_KEY, options);
