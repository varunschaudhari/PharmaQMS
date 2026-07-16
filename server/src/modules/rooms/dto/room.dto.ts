// API request types are always imported from shared, never redefined (CLAUDE.md).
export {
  createRoomCleaningAmendmentRequestSchema,
  createRoomRequestSchema,
  listRoomsQuerySchema,
  logRoomCleaningRequestSchema,
  transitionRoomStatusRequestSchema,
  updateRoomRequestSchema,
  upsertRoomCleaningScheduleRequestSchema,
  type CreateRoomCleaningAmendmentRequest,
  type CreateRoomRequest,
  type ListRoomsQuery,
  type LogRoomCleaningRequest,
  type TransitionRoomStatusRequest,
  type UpdateRoomRequest,
  type UpsertRoomCleaningScheduleRequest,
} from '@pharmaqms/shared';
