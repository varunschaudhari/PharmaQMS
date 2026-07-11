import type { AuditFieldChange } from '@pharmaqms/shared';
import { Types } from 'mongoose';

// Fields that must never appear in an audit diff: internal bookkeeping (noise) or sensitive
// credentials (passwordHash — defense-in-depth in case a caller ever diffs a raw user document).
const DEFAULT_IGNORED_FIELDS = ['_id', '__v', 'createdAt', 'updatedAt', 'passwordHash'];

function normalizeValue(value: unknown): unknown {
  if (value instanceof Types.ObjectId) {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeValue(entry)]),
    );
  }
  return value;
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// PLT-2: field-level old->new diff between two plain snapshots (SPEC.md §5.1). Only fields that
// actually changed are reported; ObjectId/Date values are normalized to strings for stable,
// JSON-serializable storage in the audit event.
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  ignoreFields: string[] = DEFAULT_IGNORED_FIELDS,
): AuditFieldChange[] {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const ignored = new Set(ignoreFields);
  const fields = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  const changes: AuditFieldChange[] = [];
  for (const field of fields) {
    if (ignored.has(field)) {
      continue;
    }
    const oldValue = normalizeValue(beforeObj[field]);
    const newValue = normalizeValue(afterObj[field]);
    if (!isEqual(oldValue, newValue)) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}
