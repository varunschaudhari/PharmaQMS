import { Injectable } from '@nestjs/common';
import { NotificationEvent } from '@pharmaqms/shared';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { DocumentsService } from './documents.service';

const DUE_SOON_WINDOW_DAYS = 30;

// DOC-6: registered into the PLT-6 due-date scanner framework (see DocumentsModule.onModuleInit)
// — runs once per tenant per day; findings become deduped notifications to the document author.
@Injectable()
export class DocumentReviewScanner implements DueDateScanner {
  readonly key = 'documents.periodic-review';

  constructor(private readonly documentsService: DocumentsService) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const due = await this.documentsService.listReviewDue(context.tenantId, DUE_SOON_WINDOW_DAYS, context.now);
    return due.map((document) => {
      const overdue = new Date(document.nextReviewDate!) <= context.now;
      const event = overdue ? NotificationEvent.OVERDUE : NotificationEvent.DUE_SOON;
      const dueDate = document.nextReviewDate!.slice(0, 10);
      return {
        userId: document.authorId,
        event,
        entityType: 'Document',
        entityId: document.id,
        title: overdue
          ? `Periodic review OVERDUE: ${document.docNumber}`
          : `Periodic review due soon: ${document.docNumber}`,
        body: `${document.docNumber} — ${document.title} is due for periodic review on ${dueDate}. Outcome: reaffirm or revise (SPEC DOC-6).`,
        // Stable per document per due date: a reaffirm/revision moves the date and re-arms it.
        dedupeKey: `doc-review:${event}:${document.id}:${dueDate}`,
      };
    });
  }
}
