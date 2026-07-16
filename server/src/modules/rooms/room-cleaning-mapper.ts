import type { RoomCleaningEntryData } from '@pharmaqms/shared';
import type { RoomCleaningEntryDocument } from './schemas/room-cleaning-entry.schema';

// Shared by RoomCleaningService and RoomService.getStatusCard() (which needs the last 5 entries
// without importing RoomCleaningService itself — a plain data mapper avoids that service
// coupling, same precedent as equipment's logbook-mapper.ts).
export function toRoomCleaningEntryData(doc: RoomCleaningEntryDocument): RoomCleaningEntryData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    roomId: doc.roomId.toString(),
    entryType: doc.entryType,
    cleaningType: doc.cleaningType,
    remarks: doc.remarks,
    amendsEntryId: doc.amendsEntryId ? doc.amendsEntryId.toString() : null,
    performedByUserId: doc.performedByUserId,
    performedByUserFullName: doc.performedByUserFullName,
    occurredAt: doc.occurredAt.toISOString(),
  };
}
