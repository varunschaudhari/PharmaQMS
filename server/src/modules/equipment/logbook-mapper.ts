import type { LogbookEntryData } from '@pharmaqms/shared';
import type { LogbookEntryDocument } from './schemas/logbook-entry.schema';

// Shared by LogbookService and EquipmentService.getStatusCard() (which needs the last 5 entries
// without importing LogbookService itself — a plain data mapper avoids that service coupling).
export function toLogbookEntryData(doc: LogbookEntryDocument): LogbookEntryData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    entryType: doc.entryType,
    productBatchRef: doc.productBatchRef,
    cleaningType: doc.cleaningType,
    description: doc.description,
    photoFileName: doc.photoFileName,
    photoContentType: doc.photoContentType,
    amendsEntryId: doc.amendsEntryId ? doc.amendsEntryId.toString() : null,
    performedByUserId: doc.performedByUserId,
    performedByUserFullName: doc.performedByUserFullName,
    occurredAt: doc.occurredAt.toISOString(),
  };
}
