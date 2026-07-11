// PLT-4: actions a caller can perform against a WorkflowInstance (SPEC.md §6.1 / §7.1 DOC-3).
export enum WorkflowAction {
  SUBMIT = 'submit',
  APPROVE = 'approve',
  REJECT = 'reject',
  REASSIGN = 'reassign',
}
