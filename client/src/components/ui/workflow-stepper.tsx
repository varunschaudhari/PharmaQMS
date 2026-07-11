import type { WorkflowInstanceData } from '@pharmaqms/shared';

export interface WorkflowStepperProps {
  instance: WorkflowInstanceData;
}

// PLT-4: visualizes an instance's progress through its template's steps. Deliberately only uses
// data available on the instance itself (currentStep, currentStepIndex, totalSteps) rather than
// fetching the full template — template step names are only visible to admins (GET
// /workflow/templates requires admin:view), but any eligible assignee needs to see this.
export function WorkflowStepper({ instance }: WorkflowStepperProps) {
  if (instance.status === 'draft') {
    return <p className="text-sm text-slate-600">Not yet submitted (or returned to the author for revision).</p>;
  }

  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {Array.from({ length: instance.totalSteps }, (_, index) => {
          const isApproved = instance.status === 'approved';
          const isCompleted = isApproved || index < instance.currentStepIndex;
          const isCurrent = !isApproved && index === instance.currentStepIndex;

          const badgeClass = isCompleted
            ? 'bg-emerald-600 text-white'
            : isCurrent
              ? 'bg-slate-900 text-white'
              : 'bg-slate-200 text-slate-500';

          return (
            <li key={index} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${badgeClass}`}
              >
                {isCompleted ? '✓' : index + 1}
              </span>
              {index < instance.totalSteps - 1 && <span className="text-slate-300">→</span>}
            </li>
          );
        })}
        {instance.status === 'approved' && (
          <li className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Approved</li>
        )}
      </ol>
      {instance.currentStep && (
        <p className="text-sm font-medium text-slate-900">
          Step {instance.currentStepIndex + 1} of {instance.totalSteps}: {instance.currentStep.name}
        </p>
      )}
    </div>
  );
}
