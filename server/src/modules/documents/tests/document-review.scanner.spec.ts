import { NotificationEvent, WhatsAppTemplateKey, type DocumentData } from '@pharmaqms/shared';
import { DocumentReviewScanner } from '../document-review.scanner';
import type { DocumentsService } from '../documents.service';

describe('DOC-6 periodic-review due-date scanner', () => {
  const authorId = 'author-1';

  function documentFixture(overrides: Partial<DocumentData>): DocumentData {
    return {
      id: 'doc-1',
      tenantId: 'tenant-1',
      docNumber: 'SOP-QA-001',
      title: 'Cleaning of pH meters',
      docType: 'sop',
      departmentId: 'dept-1',
      reviewFrequencyMonths: 12,
      authorId,
      status: 'effective',
      effectiveVersion: null,
      latestVersion: null as unknown as DocumentData['latestVersion'],
      nextReviewDate: '2026-08-01T00:00:00.000Z',
      createdAt: '2025-08-01T00:00:00.000Z',
      ...overrides,
    } as DocumentData;
  }

  function scannerWith(due: DocumentData[]): DocumentReviewScanner {
    const documentsService = { listReviewDue: jest.fn().mockResolvedValue(due) } as unknown as DocumentsService;
    return new DocumentReviewScanner(documentsService);
  }

  it('DOC-6: registers under a stable key the framework can dedupe on', () => {
    expect(scannerWith([]).key).toBe('documents.periodic-review');
  });

  it('DOC-6: a document past its review date maps to an OVERDUE finding for the author', async () => {
    const scanner = scannerWith([documentFixture({ nextReviewDate: '2026-07-01T00:00:00.000Z' })]);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T05:00:00.000Z') });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      userId: authorId,
      event: NotificationEvent.OVERDUE,
      entityType: 'Document',
      entityId: 'doc-1',
      dedupeKey: 'doc-review:overdue:doc-1:2026-07-01',
    });
    expect(findings[0].title).toContain('OVERDUE');
    expect(findings[0].body).toContain('SOP-QA-001');
  });

  it('PLT-6-WA: the finding carries a DOCUMENT_REVIEW_DUE WhatsApp template with docNumber/title/dueDate params', async () => {
    const scanner = scannerWith([documentFixture({ nextReviewDate: '2026-07-01T00:00:00.000Z' })]);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T05:00:00.000Z') });

    expect(findings[0].whatsapp).toEqual({
      templateKey: WhatsAppTemplateKey.DOCUMENT_REVIEW_DUE,
      params: ['SOP-QA-001', 'Cleaning of pH meters', '2026-07-01'],
    });
  });

  it('DOC-6: a document due within the window (but not past) maps to DUE_SOON, with a dedupeKey stable across daily runs', async () => {
    const document = documentFixture({ nextReviewDate: '2026-08-01T00:00:00.000Z' });
    const scanner = scannerWith([document]);

    const day1 = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T05:00:00.000Z') });
    const day2 = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-12', now: new Date('2026-07-12T05:00:00.000Z') });

    expect(day1[0].event).toBe(NotificationEvent.DUE_SOON);
    // Same logical fact on consecutive days -> identical dedupeKey -> PLT-6 creates it once.
    expect(day1[0].dedupeKey).toBe(day2[0].dedupeKey);
  });
});
