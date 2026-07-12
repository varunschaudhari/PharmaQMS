# Phase 0 Definition-of-Done Demo (SPEC.md §8)

> *"A dummy 'test record' can be created, routed through a 2-step approval with e-signs, every
> action visible in its history tab, QR resolves to it."*

This document records how the gate was verified and how to replay it in a browser. The same
journey is automated in `server/src/demo/test-record/tests/test-record.e2e-spec.ts` (9 tests,
nothing mocked) and was additionally driven live over HTTP against real Docker Mongo + Redis on
2026-07-11 — all checks passed.

The demo entity (`TestRecord`) is deliberately **throwaway**: it lives in `server/src/demo/`
(not the phase-gated `server/src/modules/`) plus `client/src/features/test-records/`, and is
deleted once DOC/TRN/EQP exercise the same integrations for real.

## Prerequisites

1. `docker compose up -d` (Mongo + Redis).
2. `npm run dev` at the repo root (server on :4000, client on :5173).
3. A provisioned tenant. One-time bootstrap, in order:
   - Seed the very first platform admin directly in Mongo (documented PLT-8 operational step —
     there is deliberately no HTTP endpoint for this): a `roles` doc + a `users` doc with
     `isPlatformAdmin: true`.
   - Log in as the platform admin → **Tenants** page → provision the demo tenant with its
     initial admin.
   - Set `VITE_DEFAULT_TENANT_ID` in `client/.env` to the new tenant id (v1 single-tenant
     login) and restart the client dev server.
4. Seed two approver roles directly in Mongo for the tenant — `Dept Head` and `QA Head`
   (`permissions: []`). *(Known gap, flagged since PLT-4: roles have no HTTP surface yet;
   tenant provisioning creates only the full-permission "Tenant Admin" role.)*
5. Logged in as the tenant admin, in the UI:
   - **Users** page → create `dept.head@…` (Dept Head role) and `qa.head@…` (QA Head role).
   - **Numbering** page → create scheme: entityType `TEST-RECORD`, prefix `TR`, padding 4,
     no department token, no yearly reset.
6. Create the workflow template (admin, via API — template admin UI is a later session):
   `POST /api/v1/workflow/templates` with entityType `TestRecord` and two steps:
   `Dept Head Review` (Dept Head role, meaning `reviewed_by`, rejectToStepIndex `null`) and
   `QA Head Approval` (QA Head role, meaning `approved_by`, rejectToStepIndex `0`).

## Demo script (browser)

| # | Actor | Action | Platform service proven |
|---|---|---|---|
| 1 | Tenant admin | **Test Records** → create "Phase 0 dummy record" | PLT-5: number `TR-0001` appears, never typed; PLT-7: QR code minted on the detail page |
| 2 | Tenant admin | Detail page → *Rename record* → save | PLT-2: History tab shows `update` with field-level `title: old → new` diff |
| 3 | Tenant admin | *Submit for approval* | PLT-4: stepper shows Step 1 of 2 "Dept Head Review" |
| 4 | Dept Head | Log in (or *Switch user*) → notification bell shows **Approval task: TestRecord …**; **Pending Tasks** lists it | PLT-6: task-assigned notification; PLT-1: role-based assignment |
| 5 | Dept Head | Open task → *Approve* → SignatureDialog demands the password again | PLT-3 / Iron Rule 4: a live session is NOT a signature |
| 6 | QA Head | Same flow — approve step 2 | PLT-4: instance reaches **Approved**; PLT-3: second signature |
| 7 | Tenant admin | Bell shows **Approved: TestRecord …**; detail page Signatures panel lists *Reviewed by* (Dana) and *Approved by* (Quinn) with timestamps | PLT-6 outcome notification; PLT-3 signature manifest |
| 8 | Tenant admin | History tab: `create`, `update`, `workflow_submitted`, `workflow_step_approved`, `workflow_approved` — every action, actor, timestamp | PLT-2: full audit trail |
| 9 | Any tenant user | Detail page → QR block → *open mobile view* (or scan the printed label with a phone) → `/s/:code` renders the phone-first card with the persistent "Logged in as {name}" banner | PLT-7: QR resolves to the record; §7.3 mobile UX |
| 10 | Any tenant user | *Single label PDF* / *A4 sheet PDF* download and print | PLT-7: printable labels (QR + entity code + name) |
| 11 | Operator (no admin perms) | Try to create a record → 403 | PLT-1: RBAC denial |
| 12 | User in another tenant | Open the record URL or scan the QR → 404 | PLT-8 / Iron Rule 5: tenant isolation |

Bonus check while logged out: open `/s/{code}` directly — you are sent to login and, after
signing in, land back on the scanned record (login preserves the scan target).

## Evidence

- Automated: `npx jest src/demo` — `Phase 0 gate — PLT-1 … PLT-8 integration`, 9 tests passing.
- Live HTTP run: scratchpad `verify-phase0.js`, all checks passed against real Mongo/Redis
  (including a real puppeteer-rendered label PDF and real BullMQ-delivered notification email).

## Known gaps carried forward (non-blocking for the gate)

- Roles and workflow templates have no admin UI/HTTP CRUD yet (seeded directly / via API).
- The mobile `/s/:code` view renders a generic entity card; entity-type-specific mobile views
  (EQP status card etc.) arrive with their Phase 1 modules.
