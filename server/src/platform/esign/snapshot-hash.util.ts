import { createHash } from 'node:crypto';

// Recursively sorts object keys so the same logical snapshot always serializes identically,
// regardless of property insertion order (otherwise the SHA-256 hash would be unstable).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

// PLT-3: SHA-256 hash of the entity snapshot at signing time (SPEC.md §5.2 / Iron Rule 4).
export function hashEntitySnapshot(snapshot: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalize(snapshot));
  return createHash('sha256').update(canonical).digest('hex');
}

// Detects tampering: true only if `snapshot` serializes to the same hash the signature stored.
export function verifyEntitySnapshot(snapshot: Record<string, unknown>, expectedHash: string): boolean {
  return hashEntitySnapshot(snapshot) === expectedHash;
}
