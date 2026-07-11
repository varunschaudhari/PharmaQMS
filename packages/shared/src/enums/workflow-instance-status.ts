// PLT-4: a workflow instance's lifecycle status. DRAFT covers both "never submitted" and
// "returned for revision after a rejection with no configured earlier step" (SPEC.md §7.1 DOC-3:
// rejection "returns to the author in Draft-revision state").
export enum WorkflowInstanceStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  APPROVED = 'approved',
}
