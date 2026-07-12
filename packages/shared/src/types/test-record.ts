import type { WorkflowInstanceData } from './workflow';

// Phase 0 gate (SPEC.md §8): the throwaway demo entity that exercises every platform service
// together. NOT a business module — lives under server/src/demo and is removed once real
// modules (DOC/TRN/EQP) prove the same integrations.
export interface TestRecordData {
  id: string;
  tenantId: string;
  // PLT-5: assigned by the numbering service at creation, e.g. TR-0001 — never inline.
  recordNumber: string;
  title: string;
  description: string;
  createdAt: string;
  // PLT-4: joined at read time — the workflow instance is the approval-state authority.
  workflow: WorkflowInstanceData | null;
  // PLT-7: minted at creation.
  qr: { code: string; scanUrl: string } | null;
}
