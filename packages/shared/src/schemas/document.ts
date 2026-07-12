import { z } from 'zod';
import { DocumentType } from '../enums/document';

// DOC-1: create a document (metadata; the file itself travels as multipart alongside these
// fields, so numeric fields arrive as strings and are coerced).
export const createDocumentRequestSchema = z.object({
  title: z.string().min(1, 'title is required'),
  docType: z.nativeEnum(DocumentType),
  departmentId: z.string().min(1, 'departmentId is required'),
  reviewFrequencyMonths: z.coerce.number().int().min(1).max(120),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const updateDocumentRequestSchema = z.object({
  title: z.string().min(1).optional(),
  reviewFrequencyMonths: z.coerce.number().int().min(1).max(120).optional(),
});
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

// DOC-2 major/minor versioning; DOC-8 mandatory change summary on every new version.
export const createDocumentVersionRequestSchema = z.object({
  bump: z.enum(['major', 'minor']),
  changeSummary: z.string().min(1, 'A change summary (what changed and why) is required on every new version.'),
});
export type CreateDocumentVersionRequest = z.infer<typeof createDocumentVersionRequestSchema>;

// DOC-9: document distribution list (which roles/departments must be trained on this document).
export const updateDocumentDistributionRequestSchema = z.object({
  roleIds: z.array(z.string()).default([]),
  departmentIds: z.array(z.string()).default([]),
});
export type UpdateDocumentDistributionRequest = z.infer<typeof updateDocumentDistributionRequestSchema>;

// DOC-7: obsolescence is e-signed (PLT-3 signing token) with a mandatory reason.
export const obsoleteDocumentRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  reason: z.string().min(1, 'A reason is required to obsolete a document.'),
});
export type ObsoleteDocumentRequest = z.infer<typeof obsoleteDocumentRequestSchema>;

// DOC-6: periodic-review reaffirmation is e-signed; the note lands in the audit trail.
export const reaffirmDocumentRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  note: z.string().min(1, 'A review note is required.'),
});
export type ReaffirmDocumentRequest = z.infer<typeof reaffirmDocumentRequestSchema>;

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  docType: z.nativeEnum(DocumentType).optional(),
  search: z.string().optional(),
  // DOC-7: obsolete documents are excluded from user-facing search unless explicitly requested.
  includeObsolete: z
    .union([z.boolean(), z.string()])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
