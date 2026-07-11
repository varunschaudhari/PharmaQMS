# CLAUDE.md — PharmaQMS Build Instructions

You are building **PharmaQMS**, a 21 CFR Part 11-capable pharma eQMS SaaS. All requirements live in `SPEC.md` at the repo root — **read the relevant SPEC.md sections before every task**. Implement strictly by requirement ID (e.g., `DOC-3`, `EQP-6`, `PLT-2`). If a task is not traceable to a requirement ID, stop and ask.

## Stack

- **Language:** TypeScript everywhere. `strict: true`. No `any` — use `unknown` + narrowing if truly needed.
- **Backend:** NestJS 10+ (REST). MongoDB Atlas via Mongoose. JWT auth (access + refresh) with a separate short-lived signing token for e-signatures.
- **Frontend:** React 18 + Vite + Tailwind. TanStack Query for server state; React Router. Zustand only if genuinely needed for client state.
- **Shared:** `packages/shared` — types, enums, zod schemas used by both sides. API request/response types are ALWAYS imported from shared, never redefined.
- **Testing:** Jest + Supertest (server, with mongodb-memory-server), Vitest + React Testing Library (client).
- **PDF:** server-side (puppeteer). **QR:** `qrcode` npm, server-generated.
- **Jobs:** BullMQ (Redis) for due-date scans and notifications.

## Monorepo layout

```
/
├── CLAUDE.md
├── SPEC.md
├── package.json              # npm workspaces: server, client, packages/*
├── packages/
│   └── shared/               # types, enums, zod schemas, constants
│       └── src/
│           ├── types/        # one file per domain: auth.ts, audit.ts, document.ts, equipment.ts...
│           ├── enums/        # lifecycle states, roles, permissions, signature meanings
│           └── schemas/      # zod validation schemas (single source of validation truth)
├── server/
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── common/
│       │   ├── guards/       # JwtAuthGuard, TenantGuard, PermissionsGuard, SignatureGuard
│       │   ├── interceptors/ # AuditTrailInterceptor, ResponseInterceptor
│       │   ├── decorators/   # @CurrentUser(), @CurrentTenant(), @RequirePermission(), @Audited()
│       │   ├── filters/      # global exception filter (never leak stack traces)
│       │   └── pipes/        # ZodValidationPipe
│       ├── platform/         # PLT services — the regulated core
│       │   ├── auth/         # PLT-1
│       │   ├── audit/        # PLT-2  (append-only; see Iron Rules)
│       │   ├── esign/        # PLT-3
│       │   ├── workflow/     # PLT-4
│       │   ├── numbering/    # PLT-5
│       │   ├── notifications/# PLT-6
│       │   ├── qr/           # PLT-7
│       │   └── tenant/       # PLT-8 (tenants, users, departments, roles)
│       └── modules/          # business modules — each depends on platform, never on each other directly
│           ├── documents/    # DOC
│           ├── training/     # TRN
│           └── equipment/    # EQP
│       # each platform/module folder: *.module.ts, *.controller.ts, *.service.ts,
│       # schemas/ (mongoose), dto/ (zod-derived), tests/ (unit + e2e)
├── client/
│   └── src/
│       ├── app/              # router, providers, layout shells (desktop shell + mobile /s/ shell)
│       ├── features/         # mirror server modules: auth/, documents/, training/, equipment/, admin/
│       │   └── <feature>/    # api/ (TanStack hooks), components/, pages/, tests/
│       ├── components/ui/    # shared primitives (Button, Modal, StatusBadge, SignatureDialog, HistoryTab)
│       ├── lib/              # api client (axios instance), auth helpers, date/tz utils
│       └── mobile/           # QR scan landing routes /s/:code — lightweight, phone-first
├── validation-pack/          # regulatory deliverable — see Validation Discipline
│   ├── CHANGELOG.md
│   ├── traceability/         # auto-generated from test names
│   └── docs/
└── docker-compose.yml        # local mongo + redis
```

## Iron Rules (regulatory — violating these creates audit findings, not bugs)

1. **Audit trail everything.** Every create/update/status-change on a regulated entity MUST go through `AuditService.record()` (PLT-2) capturing actor, tenant, entity, field-level old→new diff, server UTC timestamp, and reason where SPEC requires it. Use the `@Audited()` decorator + interceptor pattern; never write audit events ad hoc.
2. **Append-only audit collection.** No service method, endpoint, or migration may update/delete `auditEvents` documents. The Mongoose model exposes create/find only.
3. **No hard deletes** on regulated entities. Status transitions only (`Obsolete`, `Retired`, `Cancelled`). Hard delete is permitted ONLY for never-submitted drafts, and even that is audited.
4. **Signatures are re-authenticated.** An e-signature (PLT-3) always requires a fresh credential challenge; a valid session is never sufficient. Signature records store: user, timestamp, meaning (from the shared enum), and SHA-256 hash of the signed record snapshot. Signed content is immutable — changes require a new version.
5. **Tenant isolation is enforced in code, not convention.** Every Mongoose schema includes `tenantId`. Every query goes through the tenant-scoped repository helper / TenantGuard context — never accept `tenantId` from request bodies or params. Every compound index starts with `tenantId`.
6. **Server time only.** Never trust client timestamps. Store UTC; format to tenant timezone (default `Asia/Kolkata`) at the presentation layer only.
7. **Validation at the edge.** All input validated with zod schemas from `packages/shared` via `ZodValidationPipe`. Controllers never receive unvalidated shapes.

## Coding conventions

- **Naming:** files kebab-case; classes PascalCase; DB collections camelCase plural. Entity codes come from PLT-5 numbering service — never generate identifiers inline.
- **Errors:** throw Nest `HttpException` subclasses with stable machine-readable error codes (shared enum). Global filter shapes all error responses identically.
- **API shape:** `GET /api/v1/{module}/{resource}`; responses `{ data, meta? }`. Pagination: `?page=&limit=` with `meta.total`.
- **State machines:** lifecycle transitions (document states, equipment status, workflow steps) are implemented as explicit transition maps in `packages/shared` — an invalid transition throws; never set status fields directly.
- **Frontend:** every regulated entity detail page includes the shared `HistoryTab` (audit trail) and, where signed, the signature manifest. Mobile `/s/` routes must work without the desktop shell, < 2s render target, and show a persistent "Logged in as {name}" banner.
- **Comments:** reference requirement IDs where implemented: `// EQP-6: logbook entries are immutable`.

## Testing discipline

- Write tests BEFORE or WITH implementation, never after the session ends.
- Test names MUST embed requirement IDs: `describe('PLT-2 audit trail', ...)`, `it('DOC-2: only one Effective version per document', ...)` — the traceability matrix is generated from these names.
- Every module must include tests for: tenant isolation (tenant A cannot read/write tenant B), audit-event emission, invalid state transitions rejected, and permission denial.
- e2e (Supertest) per controller happy path + auth failures. Do not mock the audit service in e2e — assert real audit events were written.

## Session workflow (follow every session)

1. Read the SPEC.md sections for the assigned requirement IDs. Implement ONLY those IDs — no opportunistic extras; unplanned code is a validation liability here.
2. Order of work: shared types/schemas → mongoose schemas → service + tests → controller + e2e → frontend feature → frontend tests.
3. Before finishing: run `npm run test` (all workspaces) and `npm run lint`; both must pass.
4. Commit message format: `PLT-2: audit trail service + history API + tests`.
5. Append one line to `validation-pack/CHANGELOG.md`: date, requirement IDs covered, one-sentence description, impact note (`new feature — no impact on existing validated functions` or a stated impact).
6. If SPEC.md is ambiguous or silent on something material, STOP and ask the developer — do not invent regulated behavior.

## Phase gate

Do not scaffold or implement anything under `server/src/modules/` until the Phase 0 definition-of-done demo passes (SPEC.md §8): a dummy record routed through a 2-step approval with two e-signatures, full history visible in its HistoryTab, and a QR code resolving to its mobile view.
