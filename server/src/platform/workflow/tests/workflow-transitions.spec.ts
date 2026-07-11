// PLT-4: exercises the explicit transition map from packages/shared (CLAUDE.md: "lifecycle
// transitions... implemented as explicit transition maps in packages/shared — an invalid
// transition throws"). packages/shared has no dedicated test runner configured yet, so this
// (like the rest of the suite) runs it through the server's Jest runner.
import {
  WorkflowAction,
  WorkflowInstanceStatus,
  assertWorkflowActionAllowed,
  isWorkflowActionAllowed,
} from '@pharmaqms/shared';

describe('PLT-4 workflow transition map', () => {
  it('PLT-4: SUBMIT is only allowed from DRAFT', () => {
    expect(isWorkflowActionAllowed(WorkflowInstanceStatus.DRAFT, WorkflowAction.SUBMIT)).toBe(true);
    expect(isWorkflowActionAllowed(WorkflowInstanceStatus.IN_PROGRESS, WorkflowAction.SUBMIT)).toBe(false);
    expect(isWorkflowActionAllowed(WorkflowInstanceStatus.APPROVED, WorkflowAction.SUBMIT)).toBe(false);
  });

  it('PLT-4: APPROVE/REJECT/REASSIGN are only allowed from IN_PROGRESS', () => {
    for (const action of [WorkflowAction.APPROVE, WorkflowAction.REJECT, WorkflowAction.REASSIGN]) {
      expect(isWorkflowActionAllowed(WorkflowInstanceStatus.IN_PROGRESS, action)).toBe(true);
      expect(isWorkflowActionAllowed(WorkflowInstanceStatus.DRAFT, action)).toBe(false);
      expect(isWorkflowActionAllowed(WorkflowInstanceStatus.APPROVED, action)).toBe(false);
    }
  });

  it('PLT-4: no actions are allowed from the terminal APPROVED status', () => {
    for (const action of Object.values(WorkflowAction)) {
      expect(isWorkflowActionAllowed(WorkflowInstanceStatus.APPROVED, action)).toBe(false);
    }
  });

  it('PLT-4: assertWorkflowActionAllowed() throws for an invalid transition', () => {
    expect(() => assertWorkflowActionAllowed(WorkflowInstanceStatus.DRAFT, WorkflowAction.APPROVE)).toThrow(
      /Invalid workflow transition/,
    );
    expect(() => assertWorkflowActionAllowed(WorkflowInstanceStatus.APPROVED, WorkflowAction.REJECT)).toThrow(
      /Invalid workflow transition/,
    );
  });

  it('PLT-4: assertWorkflowActionAllowed() does not throw for a valid transition', () => {
    expect(() => assertWorkflowActionAllowed(WorkflowInstanceStatus.DRAFT, WorkflowAction.SUBMIT)).not.toThrow();
    expect(() => assertWorkflowActionAllowed(WorkflowInstanceStatus.IN_PROGRESS, WorkflowAction.APPROVE)).not.toThrow();
  });
});
