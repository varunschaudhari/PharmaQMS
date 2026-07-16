import { DocumentVersionState, SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { SignatureManifest } from '../../../components/ui/signature-manifest';
import { WorkflowStepper } from '../../../components/ui/workflow-stepper';
import { fetchDepartments, fetchRoles } from '../../../lib/admin-api';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  downloadControlledCopy,
  downloadVersionFile,
  fetchDocument,
  fetchDocumentVersions,
  fetchVersionWorkflow,
  obsoleteDocument,
  submitDocumentVersion,
  updateDocumentDistribution,
} from '../../../lib/documents-api';
import { fetchSignatures } from '../../../lib/esign-api';
import { TrainingAssessmentPanel } from '../../training/components/training-assessment-panel';

// DOC-1/DOC-2/DOC-3/DOC-7: document detail — metadata, version history, workflow stepper,
// signature manifest, mandatory HistoryTab, e-signed obsolescence.
export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [obsoleteReason, setObsoleteReason] = useState('');
  const [showObsoleteDialog, setShowObsoleteDialog] = useState(false);

  const { data: document } = useQuery({
    queryKey: ['document', id],
    queryFn: () => fetchDocument(id as string),
    enabled: Boolean(id),
  });
  const { data: versions } = useQuery({
    queryKey: ['document-versions', id],
    queryFn: () => fetchDocumentVersions(id as string),
    enabled: Boolean(id),
  });

  const latest = document?.latestVersion;
  const latestInFlight =
    latest &&
    [DocumentVersionState.UNDER_REVIEW, DocumentVersionState.UNDER_APPROVAL].includes(latest.state);

  const { data: workflow } = useQuery({
    queryKey: ['document-version-workflow', id, latest?.id],
    queryFn: () => fetchVersionWorkflow(id as string, latest!.id),
    enabled: Boolean(id && latest && latest.state !== DocumentVersionState.DRAFT),
  });

  const { data: documentSignatures } = useQuery({
    queryKey: ['signatures', 'Document', id],
    queryFn: () => fetchSignatures('Document', id as string),
    enabled: Boolean(id),
  });
  const { data: versionSignatures } = useQuery({
    queryKey: ['signatures', 'DocumentVersion', latest?.id],
    queryFn: () => fetchSignatures('DocumentVersion', latest!.id),
    enabled: Boolean(latest),
  });

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['document', id] });
    void queryClient.invalidateQueries({ queryKey: ['document-versions', id] });
    void queryClient.invalidateQueries({ queryKey: ['document-version-workflow', id] });
    void queryClient.invalidateQueries({ queryKey: ['audit-history', 'Document', id] });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitDocumentVersion(id as string, latest!.id),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to submit.'),
  });

  const distributionMutation = useMutation({
    mutationFn: (payload: { roleIds: string[]; departmentIds: string[] }) =>
      updateDocumentDistribution(id as string, payload),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to update training distribution.'),
  });

  function toggleDistributionRole(roleId: string): void {
    if (!document) return;
    const current = document.distributionRoleIds;
    const next = current.includes(roleId) ? current.filter((r) => r !== roleId) : [...current, roleId];
    distributionMutation.mutate({ roleIds: next, departmentIds: document.distributionDepartmentIds });
  }

  function toggleDistributionDepartment(departmentId: string): void {
    if (!document) return;
    const current = document.distributionDepartmentIds;
    const next = current.includes(departmentId) ? current.filter((d) => d !== departmentId) : [...current, departmentId];
    distributionMutation.mutate({ roleIds: document.distributionRoleIds, departmentIds: next });
  }

  async function handleObsoleteSign(signingToken: string): Promise<void> {
    await obsoleteDocument(id as string, { signingToken, reason: obsoleteReason });
    setShowObsoleteDialog(false);
    setObsoleteReason('');
    invalidate();
  }

  if (!document || !versions) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const signatures = [...(versionSignatures ?? []), ...(documentSignatures ?? [])];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {document.docType.toUpperCase()} — {document.status.replace('_', ' ')}
          </p>
          <h1 className="text-lg font-semibold text-slate-900">
            {document.docNumber} — {document.title}
          </h1>
          <p className="text-sm text-slate-600">
            Review every {document.reviewFrequencyMonths} months
            {document.nextReviewDate ? ` — next due ${document.nextReviewDate.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {latest?.state === DocumentVersionState.DRAFT && (
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Submit for review
            </button>
          )}
          {document.effectiveVersion && (
            <button
              type="button"
              onClick={() => void downloadControlledCopy(document.id, document.effectiveVersion!)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Print controlled copy
            </button>
          )}
          {document.effectiveVersion && !latestInFlight && (
            <Link
              to={`/documents/${document.id}/new-version`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Revise (new version)
            </Link>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {workflow && latestInFlight && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Approval workflow</h2>
            <Link to={`/workflow/instances/${workflow.id}`} className="text-sm text-slate-600 underline">
              Open approval task
            </Link>
          </div>
          <div className="mt-2">
            <WorkflowStepper instance={workflow} />
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Version history</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Version</th>
              <th className="py-1 pr-4 font-medium">State</th>
              <th className="py-1 pr-4 font-medium">Change summary</th>
              <th className="py-1 pr-4 font-medium">Effective</th>
              <th className="py-1 pr-4 font-medium">File</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-4 font-medium">{version.versionLabel}</td>
                <td className="py-2 pr-4">{version.state.replace('_', ' ')}</td>
                <td className="py-2 pr-4">{version.changeSummary ?? 'Initial issue'}</td>
                <td className="py-2 pr-4">{version.effectiveDate ? version.effectiveDate.slice(0, 10) : '—'}</td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => void downloadVersionFile(document.id, version)}
                    className="text-slate-600 underline"
                  >
                    {version.fileName}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Signatures</h2>
        <SignatureManifest signatures={signatures} />
      </section>

      {document.effectiveVersion && (
        <section className="rounded border border-red-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-red-700">Obsolete this document (DOC-7)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Requires QA disposition e-signature. The document leaves user-facing search but is retained and auditable.
          </p>
          <textarea
            aria-label="Reason for obsolescence"
            placeholder="Reason (required)…"
            value={obsoleteReason}
            onChange={(event) => setObsoleteReason(event.target.value)}
            rows={2}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!obsoleteReason.trim()}
            onClick={() => setShowObsoleteDialog(true)}
            className="mt-2 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Obsolete with e-signature…
          </button>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Training distribution (DOC-9)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Roles/departments checked here must read-and-understand this document (TRN-1).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-slate-400">Roles</p>
            <ul className="mt-1 space-y-1">
              {(roles ?? []).map((role) => (
                <li key={role.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={document.distributionRoleIds.includes(role.id)}
                      onChange={() => toggleDistributionRole(role.id)}
                    />
                    {role.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-slate-400">Departments</p>
            <ul className="mt-1 space-y-1">
              {(departments ?? []).map((department) => (
                <li key={department.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={document.distributionDepartmentIds.includes(department.id)}
                      onChange={() => toggleDistributionDepartment(department.id)}
                    />
                    {department.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {latest && (
        <TrainingAssessmentPanel documentId={document.id} versionId={latest.id} versionLabel={latest.versionLabel} docNumber={document.docNumber} />
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="Document" entityId={document.id} />
      </section>

      {showObsoleteDialog && (
        <SignatureDialog
          meaning={SignatureMeaning.QA_DISPOSITION}
          onSign={handleObsoleteSign}
          onCancel={() => setShowObsoleteDialog(false)}
        />
      )}
    </div>
  );
}
