# PharmaQMS v1 Readiness — Hardening Pass (Session 19)

Date: 2026-07-12. Scope per SPEC.md §8's Phase 1 close-out: run the full suite, verify P0 requirement
traceability, audit tenant isolation / guard bypass / hard-delete discipline, load-test the `/s/:code`
scan flow, and fix any gaps found. This document is the deliverable; see
`validation-pack/traceability/traceability-matrix.md` for the generated requirement→test matrix
(re-run `node scripts/generate-traceability.js` any time to refresh it).

## 1. Test suite status

- **Server:** 58 test suites, **350 tests, all passing** (`npm run test --workspace=server`).
- **Client:** 26 test files, **64 tests, all passing** (`npm run test --workspace=client`).
- **Lint:** 0 errors across `server`, `client`, `packages/shared` (2 pre-existing client warnings,
  unrelated to this session — `react-refresh/only-export-components` on `auth-context.tsx`,
  `import/no-named-as-default-member` on `api-client.ts`).

## 2. P0 requirement traceability

`scripts/generate-traceability.js` (new this session) parses SPEC.md §6.1/§7's requirement tables
and cross-references every `describe`/`it` name across all 84 test files for embedded requirement
IDs. Result:

**All 29 P0 requirements (PLT-1…8, DOC-1…7, TRN-1…5, EQP-1…9) have at least one test referencing
their ID. Zero P0 gaps.**

P1 items already built this build cycle (DOC-8, DOC-9, EQP-10) all have test coverage too. P1/P2
items correctly NOT built yet per the phasing plan (EQP-11/12, TRN-6/7/8, DOC-10, QRX-1/2) have no
tests, as expected — they are out of v1 scope.

## 3. Tenant isolation audit (Iron Rule 5)

Audited every business module, every platform service, and every equipment sub-concern for a test
that actually constructs a second tenant and asserts cross-tenant denial (not just a grep for the
word "tenant"). Full findings:

**Strong, already in place:** equipment (every sub-concern — qualification, PM, calibration,
logbook, maintenance, history-report — has both a unit-level and e2e-level isolation test),
training, audit, auth (login boundary), notifications, qr, department, user-admin (list-scoping).
`platform/notifications` and `platform/audit` are the best examples in the codebase — both
deliberately reuse the *same* entityId/userId across two tenants to specifically defeat a
"filtered by the wrong field" bug, not just a coincidental-ID-collision bug.

**Gaps found and fixed this session:**
- **`modules/documents` had no e2e tenant-isolation test** (only a unit-level, read-only one),
  despite being the highest-risk module (uploads, e-sign approvals, controlled copies, public scan
  endpoint). Added `documents.e2e-spec.ts`: *"Iron Rule 5: an outsider tenant cannot read, list,
  download, or submit this document/version"* — covers GET single, GET list, GET file download,
  and a POST submit write attempt, all from an outsider holding `ALL_PERMISSION_KEYS` (proving
  tenant scoping rejects before permission even matters).
- **`platform/esign` had zero tenant-isolation tests** despite exposing a
  `GET :entityType/:entityId/signatures` endpoint structurally identical to audit's history
  endpoint (which was already well-tested). Added `esign.e2e-spec.ts`: *"Iron Rule 5: an outsider
  tenant cannot read this tenant's signatures for the same entityType/entityId"* — deliberately
  reuses the same `entityId` ('doc-42') across tenants, same defeat-the-wrong-filter pattern as the
  audit/notifications tests.
- **`platform/workflow`'s existing "tenant-isolated" e2e test was confounded**: it passed only
  because the outsider tenant had no workflow template configured for `'Document'` — it never
  proved denial of access to a real, pre-existing instance by id. Strengthened the same test to
  also submit a real instance in the primary tenant, then assert the outsider gets 404 on both
  `GET /workflow/instances/:id` and `POST /workflow/instances/:id/act` against that real id, and
  that the primary tenant's own view of it is unaffected.

**Gaps found, NOT fixed this session (recommended follow-ups, not release blockers — the underlying
implementation was verified correct in every case; only test *depth* is short):**
- `platform/numbering` has no e2e test file at all (isolation included) — its one isolation test
  proves counter independence, not access denial on `updateScheme`.
- The three equipment due-date scanners (`equipment-calibration.scanner.spec.ts`,
  `equipment-pm.scanner.spec.ts`, `equipment-qualification.scanner.spec.ts`) fully mock the DB
  layer, so nothing in their own specs would catch a regression that dropped the `tenantId` filter
  from the underlying Mongo query, even though the real implementation filters correctly today.
- Every equipment sub-concern's e2e isolation test checks GET/read endpoints only; only
  `maintenance.service.spec.ts` tests a cross-tenant **write** denial (`close()`). A regression in
  write-path tenant scoping specifically (as opposed to read) would not be caught elsewhere in the
  module, though the general `@CurrentTenant()`/`TenantGuard` audit (§4) found no code path that
  could plausibly bypass this for writes but not reads.
- `user-admin.service.spec.ts`'s isolation test covers `listUsers()` only; `updateUser()` and
  `department.service.spec.ts`'s `update()` are never tried with a cross-tenant target id.

## 4. Guard-bypass audit (auth/authorization)

- **Guards are global** (`JwtAuthGuard` → `TenantGuard` → `PermissionsGuard`, registered via
  `APP_GUARD` in `app.module.ts`) — every endpoint is protected by default; `@Public()` is the only
  opt-out.
- **`@Public()` usage: 4 endpoints, all deliberate and documented** — `GET /health`,
  `POST /auth/login`, `POST /auth/refresh`, `GET /public/doc-check/:code` (DOC-5). No oversights.
- **`TenantGuard`/`@CurrentTenant()` fully audited**: `tenantId` is derived exclusively from the
  JWT-populated `request.user.tenantId` everywhere, with exactly one documented, unavoidable
  exception (`POST /auth/login`, which must read `tenantId` from the body since no session exists
  yet at that pre-auth boundary). No controller anywhere accepts `tenantId` from params/query/body
  outside that one endpoint.
- **`SignatureGuard` coverage is complete** — every `EsignService.createSignature()` call site is
  gated by either the `SignatureGuard` decorator or (workflow's `approve` action only, by explicit
  design) an equivalent in-process `verifyAndConsumeSigningToken()` call. No signature-implying
  endpoint was found unprotected.
- **Genuine gap found and fixed**: `POST /workflow/instances/submit` (the generic PLT-4 endpoint)
  had **no permission check at all** tied to the target `entityType`. Because
  `DocumentsController`'s own `documents:edit`-gated `submitVersion` wrapper calls
  `WorkflowService.submit()` *in-process* (not via this HTTP endpoint), a caller with **zero**
  Documents permission could reach the exact same effect by POSTing directly to the generic
  endpoint with `entityType: 'DocumentVersion'` and any version id in their tenant — moving that
  version's workflow instance to `IN_PROGRESS`, firing real reviewer notifications, writing a
  misattributed `WORKFLOW_SUBMITTED` audit event, and consuming the `DRAFT`→`IN_PROGRESS`
  transition so the legitimate author's later, properly-permissioned submit attempt would fail.
  **Fixed**: added `packages/shared/src/workflow-submit-permissions.ts` exporting
  `WORKFLOW_SUBMIT_ENTITY_TYPE_PERMISSION` (currently `{ DocumentVersion: 'documents:edit' }` —
  plain string keys, not an import of a business module's entity-type constant, to keep the
  platform layer free of any dependency on `server/src/modules/*`), and `WorkflowController.submit()`
  now checks it before delegating to the service. EntityTypes not in the map (the throwaway
  TestRecord demo) are unaffected — same behavior as before. Regression test added:
  `documents-lifecycle.e2e-spec.ts`'s *"PLT-4 hardening: a user without documents:edit cannot
  submit a DocumentVersion via the generic workflow endpoint"*.
- **Two minor documentation gaps closed** (behavior was already correct, just undocumented):
  `EsignController.listSignatures` and `WorkflowController.getInstance` now have explanatory
  comments matching the pattern used everywhere else for auth-only (no extra permission) endpoints.

## 5. Hard-delete audit (Iron Rule 3)

**Zero hard-delete calls exist anywhere in production code.** Grepped all of `server/src`
(excluding tests) for `.deleteOne(`, `.deleteMany(`, `.findOneAndDelete(`, `.findByIdAndDelete(`,
`.remove(`, `.drop(`, and any `@Delete(...)` HTTP route — none exist. No Document, Equipment,
CalibrationRecord, TrainingAssignment, User, or any other regulated entity is ever hard-deleted by
any current service method. `AuthService`/`DepartmentService` correctly deactivate via `isActive`
instead (Iron Rule 3, explicit in-code comments). The "never-submitted draft" hard-delete
exception Iron Rule 3 anticipates has no live code path — `AuditAction.DELETE` is defined but
unused, and the one candidate ("cancel a draft") turned out to be a status transition to
`CANCELLED`, not an actual delete. The codebase is currently *more* conservative than the rule
requires.

**Structural observation (not a live violation — recommendation for future hardening, not fixed
this session):** the `applyAppendOnly()` schema plugin hard-blocks `deleteOne`/`deleteMany`/
`findOneAndDelete`/`updateOne`/`updateMany`/`findOneAndUpdate`/non-new `save()` at the Mongoose
layer for exactly 3 collections (`auditEvents`, `signatures`, `logbookEntries`). The other 18
regulated-entity schemas (Document, DocumentVersion, Equipment, CalibrationRecord, TrainingAssignment,
etc.) rely entirely on "no service currently calls delete" rather than a schema-level block — a
structurally weaker, discipline-only guarantee. Since applying the plugin broadly would also
foreclose ever implementing Iron Rule 3's own "never-submitted draft" exception without first
extending the plugin with an escape hatch, this was deliberately left as a documented recommendation
rather than an autonomous mechanical change across 18 schemas.

## 6. `/s/:code` scan-flow load test

Drove 200 concurrent `GET /qr/resolve/:code` → `GET /equipment/:id/status-card` round trips (20
workers × 10 rounds) against the real running server + real Docker Mongo/Redis:

- **0 errors** across all 200 round trips.
- Round-trip latency: min 38ms, p50 337ms, p95 618ms, **p99 717ms**, max 889ms.
- Effective throughput: ~53 req/s sustained.

This is a local-machine floor measurement (single dev machine, not "mid-range Android over plant
Wi-Fi" per SPEC §7.3) but comfortably clears the <2s scan-to-card target with room to spare even
under concurrent load.

## 7. Overall verdict

**No P0 requirement is untested. No live tenant-isolation bypass, guard bypass, or hard-delete
violation exists in the codebase as of this session.** One real, exploitable authorization gap
(the generic workflow-submit endpoint) was found and fixed, with a regression test. Several test
*coverage* gaps (not implementation bugs) were found and partially closed (documents/esign
tenant-isolation e2e tests added, workflow's confounded test fixed); the remainder are listed above
as recommended follow-ups for a future session, prioritized roughly:

1. Numbering module e2e test suite (currently has zero HTTP-level tests of any kind).
2. Equipment scanners' unit tests should assert the actual Mongo query filter (not fully mock it away).
3. Cross-tenant **write** attempts on equipment sub-concerns beyond the one existing example (`maintenance.close()`).
4. Extend `applyAppendOnly()` (or an equivalent schema-level guard) to more regulated entities, with an explicit escape hatch for the never-submitted-draft exception, if post-v1 hardening budget allows.
