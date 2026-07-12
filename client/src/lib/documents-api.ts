import type {
  DocumentData,
  DocumentType,
  DocumentVersionData,
  PaginationMeta,
  WorkflowInstanceData,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface DocumentsListResponse {
  data: DocumentData[];
  meta: PaginationMeta;
}

export async function fetchDocuments(options?: {
  page?: number;
  limit?: number;
  docType?: DocumentType;
  search?: string;
  includeObsolete?: boolean;
}): Promise<DocumentsListResponse> {
  const response = await apiClient.get('/documents', {
    params: {
      page: options?.page ?? 1,
      limit: options?.limit ?? 20,
      ...(options?.docType ? { docType: options.docType } : {}),
      ...(options?.search ? { search: options.search } : {}),
      includeObsolete: options?.includeObsolete ?? false,
    },
  });
  return response.data;
}

export async function fetchDocument(id: string): Promise<DocumentData> {
  const response = await apiClient.get(`/documents/${id}`);
  return response.data.data;
}

// DOC-9: which roles/departments must be trained on this document (TRN-1's mapping source).
export async function updateDocumentDistribution(
  id: string,
  payload: { roleIds: string[]; departmentIds: string[] },
): Promise<DocumentData> {
  const response = await apiClient.patch(`/documents/${id}/distribution`, payload);
  return response.data.data;
}

export async function fetchDocumentVersions(id: string): Promise<DocumentVersionData[]> {
  const response = await apiClient.get(`/documents/${id}/versions`);
  return response.data.data;
}

export async function fetchVersionWorkflow(id: string, versionId: string): Promise<WorkflowInstanceData | null> {
  const response = await apiClient.get(`/documents/${id}/versions/${versionId}/workflow`);
  return response.data.data;
}

export interface CreateDocumentInput {
  title: string;
  docType: DocumentType;
  departmentId: string;
  reviewFrequencyMonths: number;
  file: File;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentData> {
  const form = new FormData();
  form.append('title', input.title);
  form.append('docType', input.docType);
  form.append('departmentId', input.departmentId);
  form.append('reviewFrequencyMonths', String(input.reviewFrequencyMonths));
  form.append('file', input.file);
  const response = await apiClient.post('/documents', form);
  return response.data.data;
}

export interface CreateVersionInput {
  bump: 'major' | 'minor';
  changeSummary: string;
  file: File;
}

export async function createDocumentVersion(id: string, input: CreateVersionInput): Promise<DocumentVersionData> {
  const form = new FormData();
  form.append('bump', input.bump);
  form.append('changeSummary', input.changeSummary);
  form.append('file', input.file);
  const response = await apiClient.post(`/documents/${id}/versions`, form);
  return response.data.data;
}

export async function submitDocumentVersion(id: string, versionId: string): Promise<DocumentVersionData> {
  const response = await apiClient.post(`/documents/${id}/versions/${versionId}/submit`);
  return response.data.data;
}

export async function obsoleteDocument(
  id: string,
  payload: { signingToken: string; reason: string },
): Promise<DocumentData> {
  const response = await apiClient.post(`/documents/${id}/obsolete`, payload);
  return response.data.data;
}

export async function reaffirmDocument(
  id: string,
  payload: { signingToken: string; note: string },
): Promise<DocumentData> {
  const response = await apiClient.post(`/documents/${id}/review/reaffirm`, payload);
  return response.data.data;
}

export async function fetchReviewDue(): Promise<DocumentData[]> {
  const response = await apiClient.get('/documents/review-due');
  return response.data.data;
}

// DOC-4: server-stamped controlled copy (header block, watermark, version-check QR) — the
// download itself is audited server-side (who printed which version when).
export async function downloadControlledCopy(id: string, version: DocumentVersionData): Promise<void> {
  const response = await apiClient.get(`/documents/${id}/versions/${version.id}/controlled-copy.pdf`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `controlled-copy-${version.versionLabel}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadVersionFile(id: string, version: DocumentVersionData): Promise<void> {
  const response = await apiClient.get(`/documents/${id}/versions/${version.id}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = version.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
