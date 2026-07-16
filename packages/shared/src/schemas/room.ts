import { z } from 'zod';
import { CleaningType } from '../enums/logbook';
import { RoomCleaningFrequency, RoomClassification, RoomStatus } from '../enums/room';

// QRX-1: room/area master create/update — mirrors createEquipmentRequestSchema's shape.
export const createRoomRequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  block: z.string().optional(),
  classification: z.nativeEnum(RoomClassification).default(RoomClassification.GENERAL),
  departmentId: z.string().min(1).optional(),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z.object({
  name: z.string().min(1).optional(),
  block: z.string().optional(),
  classification: z.nativeEnum(RoomClassification).optional(),
  departmentId: z.string().min(1).nullable().optional(),
});
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const listRoomsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(RoomStatus).optional(),
  search: z.string().optional(),
});
export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>;

// QRX-1: the only way status changes — never a direct field write (CLAUDE.md transition maps).
export const transitionRoomStatusRequestSchema = z.object({
  status: z.nativeEnum(RoomStatus),
  reason: z.string().optional(),
});
export type TransitionRoomStatusRequest = z.infer<typeof transitionRoomStatusRequestSchema>;

// QRX-1: recurring cleaning schedule (create or replace — one active schedule per room, same
// upsert pattern as EQP-4's calibration schedule).
export const upsertRoomCleaningScheduleRequestSchema = z.object({
  routineFrequency: z.nativeEnum(RoomCleaningFrequency),
  fullCleaningIntervalDays: z.coerce.number().int().min(1).max(365),
  nextRoutineDueDate: z.string().min(1, 'nextRoutineDueDate is required'),
  nextFullDueDate: z.string().min(1, 'nextFullDueDate is required'),
});
export type UpsertRoomCleaningScheduleRequest = z.infer<typeof upsertRoomCleaningScheduleRequestSchema>;

// QRX-1: logging a cleaning entry via an authenticated scan — same pattern as EQP-6's
// logCleaningRequestSchema, plus optional free-text remarks.
export const logRoomCleaningRequestSchema = z.object({
  cleaningType: z.nativeEnum(CleaningType),
  remarks: z.string().optional(),
});
export type LogRoomCleaningRequest = z.infer<typeof logRoomCleaningRequestSchema>;

// QRX-1: the ONLY way to "correct" an entry — mirrors EQP-6's amendment pattern exactly.
export const createRoomCleaningAmendmentRequestSchema = z.object({
  amendsEntryId: z.string().min(1, 'amendsEntryId is required'),
  description: z.string().min(1, 'A correction note is required'),
});
export type CreateRoomCleaningAmendmentRequest = z.infer<typeof createRoomCleaningAmendmentRequestSchema>;
