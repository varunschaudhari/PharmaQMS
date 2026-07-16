// QRX-1 (SPEC.md §7.4): room/area master. Classification distinguishes GMP-controlled areas
// (cleanrooms, sterile suites) from general areas — drives nothing yet in v1 beyond display, but
// is the field a future stricter-cleaning-frequency rule would key off.
export enum RoomClassification {
  GENERAL = 'general',
  CONTROLLED = 'controlled',
}

// Only two states in v1 — no "Under Maintenance" concept for rooms (unlike Equipment). Retired is
// terminal (Iron Rule 3: no un-retiring — a room brought back into service is a new record).
export enum RoomStatus {
  ACTIVE = 'active',
  RETIRED = 'retired',
}

// QRX-1: routine cleaning cadence. A separate `fullCleaningIntervalDays` (a plain number, not an
// enum — full cleans are typically a fixed day-count like "every 30 days") tracks the deep-clean
// interval independently of the routine one.
export enum RoomCleaningFrequency {
  PER_SHIFT = 'per_shift',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

// QRX-1: mirrors EQP-6's LogbookEntryType, narrowed to what a room actually logs — no usage/
// breakdown concept for a room (that's equipment-specific).
export enum RoomCleaningEntryType {
  CLEANING = 'cleaning',
  AMENDMENT = 'amendment',
}
