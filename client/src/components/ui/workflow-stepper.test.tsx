import { SignatureMeaning, WorkflowInstanceStatus, type WorkflowInstanceData } from '@pharmaqms/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowStepper } from './workflow-stepper';

function makeInstance(overrides: Partial<WorkflowInstanceData>): WorkflowInstanceData {
  return {
    id: 'instance-1',
    tenantId: 'tenant-1',
    templateId: 'template-1',
    entityType: 'dummy-record',
    entityId: 'entity-1',
    status: WorkflowInstanceStatus.IN_PROGRESS,
    currentStepIndex: 0,
    currentStep: {
      name: 'Dept Head Review',
      roleId: 'role-1',
      signatureMeaning: SignatureMeaning.REVIEWED_BY,
      rejectToStepIndex: null,
    },
    overrideAssigneeUserId: null,
    totalSteps: 2,
    ...overrides,
  };
}

describe('PLT-4 WorkflowStepper', () => {
  it('PLT-4: shows a draft message when the instance has not been submitted', () => {
    render(
      <WorkflowStepper
        instance={makeInstance({ status: WorkflowInstanceStatus.DRAFT, currentStepIndex: -1, currentStep: null })}
      />,
    );

    expect(screen.getByText(/not yet submitted/i)).toBeInTheDocument();
  });

  it('PLT-4: shows the current step name and position while in progress', () => {
    render(<WorkflowStepper instance={makeInstance({})} />);

    expect(screen.getByText('Step 1 of 2: Dept Head Review')).toBeInTheDocument();
  });

  it('PLT-4: shows an Approved badge once the instance is fully approved', () => {
    render(
      <WorkflowStepper
        instance={makeInstance({ status: WorkflowInstanceStatus.APPROVED, currentStepIndex: 2, currentStep: null })}
      />,
    );

    expect(screen.getByText('Approved')).toBeInTheDocument();
  });
});
