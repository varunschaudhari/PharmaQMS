import type { CleaningType } from '../enums/logbook';
import type { CalibrationStatus } from '../enums/equipment';
import type { RoomCleaningEntryType, RoomClassification, RoomCleaningFrequency, RoomStatus } from '../enums/room';

// QRX-1: room/area master (SPEC.md §7.4). `block` is free-text building/wing identifier (no
// separate Building master in v1 — same "keep it thin" philosophy as QRX being a v1.5 layer).
export interface RoomData {
  id: string;
  tenantId: string;
  // PLT-5: e.g. ROOM-001 — assigned by the numbering service at creation, never inline.
  roomCode: string;
  name: string;
  block: string | null;
  classification: RoomClassification;
  status: RoomStatus;
  // Optional — a room's overdue-cleaning notifications go to this department's head, when set.
  departmentId: string | null;
  qr: { code: string; scanUrl: string } | null;
  createdAt: string;
}

// QRX-1: one active cleaning schedule per room — mirrors EQP-4's CalibrationScheduleData shape.
// Two independent due dates: the routine cadence (per-shift/daily/weekly) and the separate
// full/deep-clean interval.
export interface RoomCleaningScheduleData {
  id: string;
  tenantId: string;
  roomId: string;
  routineFrequency: RoomCleaningFrequency;
  fullCleaningIntervalDays: number;
  nextRoutineDueDate: string;
  nextFullDueDate: string;
}

// QRX-1: one digital cleaning-log entry — immutable (mirrors EQP-6's LogbookEntryData). A
// correction is a NEW entry of type AMENDMENT referencing `amendsEntryId`, never an edit.
export interface RoomCleaningEntryData {
  id: string;
  tenantId: string;
  roomId: string;
  entryType: RoomCleaningEntryType;
  // CLEANING only — null for AMENDMENT entries.
  cleaningType: CleaningType | null;
  // Optional free-text remarks (CLEANING), or the AMENDMENT's correction note.
  remarks: string | null;
  // AMENDMENT only — the entry this one corrects (never edits).
  amendsEntryId: string | null;
  performedByUserId: string;
  performedByUserFullName: string;
  occurredAt: string;
}

// QRX-1: the scan-to-status-card view (SPEC.md §7.4) — mirrors EQP-3's EquipmentStatusCardData,
// narrowed to what a room actually has: cleaning status (color-coded), current status, and the
// log-cleaning action.
export interface RoomStatusCardData {
  id: string;
  roomCode: string;
  name: string;
  block: string | null;
  classification: RoomClassification;
  status: RoomStatus;
  cleaningStatus: CalibrationStatus;
  nextRoutineDueDate: string | null;
  nextFullDueDate: string | null;
  lastCleaningEntry: RoomCleaningEntryData | null;
  recentCleaningEntries: RoomCleaningEntryData[];
  availableActions: string[];
}

// QRX-1: one row of the overdue/due-soon cleaning dashboard feed — mirrors EQP-4's
// CalibrationDueEntryData.
export interface RoomCleaningDueEntryData {
  roomId: string;
  roomCode: string;
  roomName: string;
  cleaningStatus: CalibrationStatus;
  nextDueDate: string;
}
