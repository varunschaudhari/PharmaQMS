import type { DocVersionCheckData } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../features/auth/context/auth-context';
import { extractErrorMessage } from '../../lib/api-error';
import { checkDocVersion, resolveQrCode } from '../../lib/qr-api';
import { EquipmentStatusCard } from '../components/equipment-status-card';
import { MobileShell } from '../mobile-shell';

// PLT-7 / DOC-5: /s/:code — the scan landing router. Printed controlled-copy codes resolve to
// the PUBLIC version check first (no login, no PII); every other code requires an authenticated,
// tenant-scoped session and hands off to the entity-type-specific mobile view.
export function ScanLandingPage() {
  const { code } = useParams<{ code: string }>();
  const { isAuthenticated, isLoading } = useAuth();

  // DOC-5: try the public check before demanding a login — a shop-floor scan of a printed SOP
  // must answer CURRENT/OBSOLETE with zero friction.
  const { data: docCheck, isLoading: isCheckLoading } = useQuery({
    queryKey: ['doc-check', code],
    queryFn: () => checkDocVersion(code ?? ''),
    enabled: Boolean(code),
    retry: false,
  });

  if (isLoading || isCheckLoading) {
    return null;
  }

  if (docCheck) {
    return <VersionCheckCard check={docCheck} isAuthenticated={isAuthenticated} />;
  }

  if (!isAuthenticated) {
    // Preserve the scanned target through login — after signing in the operator lands straight
    // back on this entity, not on the desktop home page.
    return <Navigate to={`/login?redirect=${encodeURIComponent(`/s/${code ?? ''}`)}`} replace />;
  }

  return (
    <MobileShell>
      <ResolvedEntity code={code ?? ''} />
    </MobileShell>
  );
}

// DOC-5: "✔ CURRENT — v3.0 effective 01-Aug-2026" / "✘ OBSOLETE — current version is v4.0".
function VersionCheckCard({ check, isAuthenticated }: { check: DocVersionCheckData; isAuthenticated: boolean }) {
  const isCurrent = check.status === 'current';
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto w-full max-w-md p-4">
        <div
          className={`rounded-lg border-2 p-6 text-center shadow-sm ${
            isCurrent ? 'border-emerald-500 bg-emerald-50' : 'border-red-500 bg-red-50'
          }`}
        >
          <p className={`text-4xl font-bold ${isCurrent ? 'text-emerald-600' : 'text-red-600'}`}>
            {isCurrent ? '✔ CURRENT' : '✘ OBSOLETE'}
          </p>
          <p className="mt-3 text-sm font-medium text-slate-900">{check.docNumber}</p>
          {isCurrent ? (
            <p className="mt-1 text-sm text-slate-700">
              v{check.scannedVersion}
              {check.scannedEffectiveDate ? ` — effective ${check.scannedEffectiveDate.slice(0, 10)}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-700">
              This printed copy is v{check.scannedVersion}.
              {check.currentVersion
                ? ` The current version is v${check.currentVersion} — destroy this copy and reprint.`
                : ' No version is currently effective.'}
            </p>
          )}
        </div>
        <div className="mt-4 text-center">
          {isAuthenticated ? (
            <Link to={`/documents/${check.documentId}`} className="text-sm text-slate-600 underline">
              Open the document
            </Link>
          ) : (
            <Link
              to={`/login?redirect=${encodeURIComponent(`/documents/${check.documentId}`)}`}
              className="text-sm text-slate-600 underline"
            >
              Log in to open the document
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}

function ResolvedEntity({ code }: { code: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['qr-resolve', code],
    queryFn: () => resolveQrCode(code),
    enabled: code.length > 0,
    retry: false,
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Resolving code…</p>;
  }
  if (error || !data) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">
          {extractErrorMessage(error) ?? 'This code could not be resolved.'}
        </p>
        <p className="mt-1 text-xs text-red-600">Check that you are logged into the right site, or contact QA.</p>
      </div>
    );
  }

  // EQP-3: equipment scans render the real status card; every other entity type still gets the
  // generic stub until its own module lands.
  if (data.entityType === 'Equipment') {
    return <EquipmentStatusCard equipmentId={data.entityId} />;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">{data.entityType}</p>
      <h1 className="mt-1 text-lg font-semibold text-slate-900">{data.entityCode}</h1>
      <p className="text-sm text-slate-600">{data.entityName}</p>
      <p className="mt-4 rounded bg-slate-100 px-3 py-2 text-xs text-slate-500">
        The {data.entityType} mobile view arrives with its module in Phase 1.
      </p>
    </div>
  );
}
