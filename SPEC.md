# PharmaQMS — Product & Build Specification
**Version:** 0.9 (Draft — pending client discovery answers)
**Owner:** Varun Chaudhari
**Purpose of this document:** Single source of truth for building a 21 CFR Part 11-capable eQMS SaaS for Indian pharma exporters, using Claude Code. Structured so each phase maps to buildable sessions.

---

## 1. Problem Statement

Indian pharma SMEs exporting to US/EU manage quality (SOPs, training, deviations, CAPA, equipment calibration) on paper and Excel. This fails under FDA/EU data-integrity scrutiny — obsolete SOPs on the floor, missed calibrations, untraceable approvals. Commercial eQMS products (Qualio, ZenQMS, Scilife) are USD-priced ($10–30k/yr) and not shop-floor-first. The wedge: an India-priced, Part 11-capable, **QR-first eQMS** where the shop floor interacts with quality records by scanning codes on machines, documents, and rooms.

**Initial customer:** A pharma company (details pending discovery — see §11 Open Questions) sourced via referral, intended as paying design partner.

## 2. Goals

1. Design partner live on v1 (Documents + Training + Equipment/QR) and using it daily within the build timeline agreed in the commercial deal.
2. Pass the design partner's next customer/regulatory audit with zero software-related observations.
3. Every record in the system is audit-trail-complete and exportable for inspection from day one.
4. QR scan-to-log adopted by shop-floor operators (target: >70% of equipment log entries created via QR scan within 60 days of rollout).
5. Architecture supports multi-tenant SaaS without rework (tenant isolation designed in v1 even if v1 runs single-tenant).

## 3. Non-Goals (v1)

- **No LIMS / instrument data capture.** No direct interfacing with HPLC, balances, chambers. QR links to records; it does not ingest instrument data. (Complexity, vendor lock-in risk.)
- **No inventory / stock movement.** Material QR = status verification only (quarantine/approved/rejected). No quantities, no consumption, no warehouse logic. (Different product; biggest scope-creep vector — hold this line.)
- **No electronic Batch Manufacturing Records (eBMR).** That is MES territory.
- **No offline mode.** Confirm plant Wi-Fi/mobile coverage instead. (Offline sync is high cost; revisit only if connectivity audit fails.)
- **No native mobile apps.** Mobile-responsive web + PWA only. QR flows must work in a phone browser with no install.
- **No deviations/CAPA/change control in v1.** Phase 2. The v1 wedge is Documents + Training + Equipment.

## 4. Users & Personas

| Persona | Role in system | Primary surface |
|---|---|---|
| QA Manager / QA Head | Owns document lifecycle, approves everything, faces auditors | Desktop web |
| QA Executive | Drafts SOPs, manages training matrix, schedules calibration | Desktop web |
| Department Head (Production/QC/Stores) | Reviews & approves documents, owns department equipment | Desktop + mobile |
| Shop-floor Operator | Scans QR, logs usage/cleaning, completes training read-and-understood | **Mobile web via QR** |
| Maintenance Engineer | Receives breakdown workflows, logs PM completion | Mobile web via QR |
| External Calibration Agency (later) | Uploads calibration certificates | Not in v1 — QA uploads on their behalf |
| Auditor (read-only concept) | Views records during inspection | QA drives; "audit view" export |
| System Admin (Varun/support) | Tenant setup, user management, master data | Admin panel |

## 5. Regulatory Foundation — READ BEFORE WRITING ANY CODE

Target: **21 CFR Part 11 / EU Annex 11 capability** + Indian Schedule M / WHO-GMP documentation practices. These are architectural requirements, not features:

### 5.1 Audit Trail (non-negotiable, every module)
- Every create/update/delete/status-change on every regulated record writes an immutable audit event: `who (user id + full name), what (entity, field-level old→new values), when (server UTC timestamp + display in plant timezone), why (reason — mandatory on changes to approved records)`.
- Audit trail is **append-only**. No API, admin tool, or DB role used by the app may update or delete audit rows. Implement as a separate collection/table with insert-only privileges.
- Audit trail is viewable per-record (a "History" tab on every entity) and exportable (PDF/CSV) for inspections.
- Record deletion is prohibited for regulated entities. Use status = `retired/obsolete/cancelled` instead. Hard delete exists only for drafts never submitted.

### 5.2 Electronic Signatures
- A signature event captures: signer identity (unique user), date/time, and **meaning** of signature (e.g., "Reviewed by", "Approved by", "Trained — read and understood").
- Signing requires re-authentication at the moment of signing: password or PIN re-entry (configurable per tenant). A session login alone is NOT a signature.
- Signed records display the signature manifest (name, meaning, timestamp) on screen and on all printed/PDF output.
- Signatures are cryptographically bound to record content: store a hash of the record snapshot at signing time; any later change to signed content requires a new version, never mutation.

### 5.3 Access Control & Identity
- Unique, non-reusable user accounts. No shared logins — enforce at policy and UI level (e.g., visible "logged in as" banner on shop-floor devices).
- Role-based access control (RBAC) with per-module permissions (view / create / edit / review / approve / admin). Roles are tenant-configurable from a permission matrix.
- Password policy: configurable complexity + expiry; account lockout after N failed attempts (logged to audit trail).
- Session timeout configurable (shorter on shared devices).

### 5.4 Data Integrity (ALCOA+)
- Attributable, Legible, Contemporaneous, Original, Accurate + Complete, Consistent, Enduring, Available.
- Server timestamps only — never trust client clocks.
- All times stored UTC; displayed in tenant timezone (IST default).
- Backups: automated daily, tested restore procedure documented (needed for the vendor qualification pack).

### 5.5 Vendor Qualification Pack (deliverable alongside software)
The client's auditors will audit US as the software supplier. Maintain from day one, in-repo under `/validation-pack/`:
- System description & architecture document
- Requirements traceability matrix (this spec's requirement IDs → test cases)
- Test evidence per release (automated test reports count)
- Release/change log with impact assessment per release
- Audit trail & e-signature design description
- Backup/restore and disaster recovery description
**Build discipline:** every P0 requirement in this spec has an ID (e.g., DOC-3). Automated tests must reference these IDs so the traceability matrix generates itself.

## 6. Architecture & Stack

Chosen to match existing skills (MERN) and validated patterns from prior builds (Patent CRM workflow engine):

- **Frontend:** React (Vite) + Tailwind. Two surfaces from one codebase: desktop app shell, and lightweight mobile routes for QR flows (`/s/:code`). PWA manifest for add-to-homescreen.
- **Backend:** Node.js + Express (or NestJS if structure preferred). REST API. JWT access + refresh tokens; short-lived signing re-auth tokens for e-signatures.
- **Database:** MongoDB Atlas. **Multi-tenant from day one**: every document carries `tenantId`; enforce via middleware on every query (never trust route params). Indexes always compound with `tenantId` first.
- **File storage:** S3-compatible (AWS S3 / GCS) for document files, certificates, attachments. Files are immutable per version — new upload = new version.
- **PDF generation:** server-side (puppeteer or pdfkit) for controlled-copy prints with QR + watermark, and for audit-trail exports.
- **QR codes:** generated server-side (`qrcode` npm), encoding short URLs `https://{app-domain}/s/{entityCode}`. Printable label sheets (A4 grids + single-label sizes).
- **Notifications:** email (transactional provider) in v1; WhatsApp (interakt/WATI or Meta Cloud API) as v1.5 — pending-approval nudges and calibration-due alerts are the killer use case.
- **Background jobs:** node-cron or BullMQ for due-date scans (calibration due, document periodic review, training overdue) and notification digests.
- **Environments:** dev / staging / prod. Prod releases require the change-log entry (§5.5).

### 6.1 Core Platform Services (build FIRST — everything depends on these)

| ID | Service | Description |
|---|---|---|
| PLT-1 | Auth & RBAC | Login, JWT, roles, permission matrix, lockout, session policy |
| PLT-2 | Audit Trail service | Single `auditEvents` writer used by all modules; per-record history API; export |
| PLT-3 | E-Signature service | Re-auth challenge, signature manifest, record-hash binding |
| PLT-4 | Workflow engine | Configurable multi-step approval flows (sequential steps, role-based assignees, reject-back-to-step, comments). Reuse Patent CRM design patterns. |
| PLT-5 | Numbering service | Tenant-configurable document/entity numbering (e.g., `SOP-QA-001`, `EQP-0042`, `TRN-2026-0113`) with no gaps/duplicates |
| PLT-6 | Notification service | Template-based email; events: assigned, due-soon, overdue, approved, rejected |
| PLT-7 | QR service | Generate/resolve short codes → entity; label PDF sheets; scan landing router `/s/:code` |
| PLT-8 | Tenant & user admin | Tenant provisioning, user CRUD, department master, role assignment |

---

## 7. v1 Modules — Functional Requirements

### 7.1 Module: Document Management (DOC)

**Purpose:** Controlled lifecycle for SOPs, specifications, protocols, formats, policies.

**Lifecycle states:** `Draft → Under Review → Under Approval → Approved/Effective → Under Revision → Obsolete` (+ `Cancelled` for drafts).

| ID | P | Requirement |
|---|---|---|
| DOC-1 | P0 | Create document with metadata: number (PLT-5), title, type (SOP/Spec/Protocol/Format/Policy), department, effective date, review frequency, author. File upload (PDF/DOCX) per version. |
| DOC-2 | P0 | Version control: major/minor versioning; only one Effective version per document; prior versions auto-marked Superseded and retained read-only. |
| DOC-3 | P0 | Review → approval workflow via PLT-4 (configurable steps, e.g., Author → Dept Head review → QA Head approval). Each step = e-signature (PLT-3) with meaning. |
| DOC-4 | P0 | Effective documents render/print as **controlled copies**: header block (doc no., version, effective date), footer watermark ("Controlled Copy — verify current version by scanning QR"), and a **QR code** resolving to the live version-check page. |
| DOC-5 | P0 | QR version check (public-ish page, no PII): scanning a printed copy shows "✔ CURRENT — v3.0 effective 01-Aug-2026" or "✘ OBSOLETE — current version is v4.0". Requires login only to open the full document. |
| DOC-6 | P0 | Periodic review: background job flags documents past review frequency; QA dashboard widget + notification. Review outcome = "reaffirm" (new review date, minor version) or "revise" (starts revision workflow). |
| DOC-7 | P0 | Obsolescence workflow with e-signature; obsolete docs excluded from user-facing search but retained and auditable. |
| DOC-8 | P1 | Change-summary field mandatory on every new version (what changed and why) — displays in version history. |
| DOC-9 | P1 | Document distribution list: which departments/roles must be trained on this document (feeds TRN module). |
| DOC-10 | P2 | In-app editor / templates. v1 = file upload only. |

**Acceptance criteria (samples — write full set as tests):**
- Given a document is Under Approval, when the approver rejects with a comment, then it returns to the author in Draft-revision state and the rejection (who/when/why) appears in the audit trail.
- Given v3.0 is Effective and v4.0 is approved, when v4.0 becomes Effective, then v3.0 auto-becomes Superseded, and scanning a printed v3.0 copy shows OBSOLETE.
- Given any state change, then an audit event exists with old→new state, actor, timestamp.

### 7.2 Module: Training Management (TRN)

**Purpose:** Prove every employee is trained on the current version of every document their role requires.

| ID | P | Requirement |
|---|---|---|
| TRN-1 | P0 | Training matrix: role/department × document mapping (from DOC-9 or manual). Adding a user to a role auto-generates their pending training items. |
| TRN-2 | P0 | Read-and-understood flow: employee opens assigned document, confirms reading, e-signs with meaning "Trained — read and understood" (PLT-3). Works on mobile. |
| TRN-3 | P0 | New effective version of a document auto-triggers retraining for all mapped users; their status flips to "Training due". |
| TRN-4 | P0 | Per-employee training record (exportable PDF): all completed trainings with signatures; the first thing auditors ask for. |
| TRN-5 | P0 | Overdue tracking: configurable grace period; overdue list on QA dashboard; notifications to employee + department head. |
| TRN-6 | P1 | Assessments: optional MCQ quiz per document; pass mark configurable; failed = retrain. |
| TRN-7 | P1 | Classroom/external training records: manual entry with certificate upload (inductions, external GMP trainings). |
| TRN-8 | P2 | Trainer-led sessions with attendance capture via QR (attendee scans session QR to mark presence). |

### 7.3 Module: Equipment & Calibration Management (EQP) — flagship

**Purpose:** Equipment master + qualification + calibration + maintenance + digital logbook, all QR-first.

| ID | P | Requirement |
|---|---|---|
| EQP-1 | P0 | Equipment master: code (PLT-5), name, make/model/serial, location (room), department, criticality (GMP-critical Y/N), status (Active / Under Maintenance / Under Qualification / Retired), install date. |
| EQP-2 | P0 | Each equipment gets a QR (PLT-7). Printable durable-label PDF (multiple sizes). Scan → mobile status card. |
| EQP-3 | P0 | **Status card (on scan):** live calibration status (Valid until DD-MMM / DUE / OVERDUE — color-coded), qualification status, PM due date, current status, last 5 logbook entries, action buttons per user role. |
| EQP-4 | P0 | Calibration: schedule per equipment (frequency, parameters, tolerance class, internal/external agency); auto-generate due tasks; record results + certificate upload; QA verification sign-off (e-sign). Overdue calibration flips equipment card to OVERDUE and (configurable) blocks usage logging with a warning. |
| EQP-5 | P0 | Out-of-tolerance (OOT) handling: failed calibration requires an impact-assessment note and flags the equipment "Do Not Use" until QA disposition (e-sign). (Full deviation linkage arrives in Phase 2 — design the reference field now.) |
| EQP-6 | P0 | **Digital logbook via QR:** authenticated operator scans → logs `Usage start/stop (product/batch ref free-text in v1)`, `Cleaning done (type: routine/full)`, `Breakdown report (description + photo)`. Every entry: auto user + server timestamp; entries immutable — corrections via strike-through-style amendment entry, never edit. |
| EQP-7 | P0 | Breakdown entry auto-creates a maintenance task assigned to maintenance role; closure requires engineer completion note + (configurable) QA/user verification. |
| EQP-8 | P0 | Qualification records: IQ/OQ/PQ entries with protocol/report file upload, dates, status; requalification due tracking. |
| EQP-9 | P0 | Preventive maintenance: PM plan per equipment (frequency, checklist text), auto task generation, completion with e-sign. |
| EQP-10 | P1 | Equipment history report (PDF): full lifecycle — qualification, all calibrations, PMs, breakdowns, logbook — the "show me everything about this machine" audit answer. |
| EQP-11 | P1 | External calibration agency management: agency master, certificate registry, agency-wise due list. |
| EQP-12 | P2 | Spare-parts linkage; utilization analytics. |

**Key mobile UX requirements (P0):**
- Scan → status card renders < 2s on mid-range Android over plant Wi-Fi.
- Logged-in session persists on registered devices (long refresh token); signing actions always demand PIN/password (PLT-3).
- Visible "Logged in as {name}" banner with fast user-switch on shared devices.

### 7.4 Module: QR Rooms & Materials (QRX) — thin layer, v1.5

| ID | P | Requirement |
|---|---|---|
| QRX-1 | P1 | Room/area master with QR: scan → cleaning status (last cleaned, by whom, due), log cleaning entry (same pattern as EQP-6). |
| QRX-2 | P1 | Material status QR label: generated against a material/lot entry with status Quarantine/Approved/Rejected; scan shows status + QA sign-off details. **View + status-change by QA only. No quantities. No movement.** (See Non-Goals.) |

---

## 8. Phasing & Build Order (Claude Code sessions)

**Phase 0 — Foundation (build first, no module works without it)**
1. Repo scaffold, environments, CI with test-run + traceability tagging
2. PLT-1 Auth/RBAC → 3. PLT-2 Audit trail → 4. PLT-3 E-signature → 5. PLT-5 Numbering → 6. PLT-8 Tenant/user admin → 7. PLT-4 Workflow engine → 8. PLT-6 Notifications → 9. PLT-7 QR service
*Definition of done: a dummy "test record" can be created, routed through a 2-step approval with e-signs, every action visible in its history tab, QR resolves to it.*

**Phase 1 — v1 modules**
10. DOC module → 11. TRN module → 12. EQP module (master+QR → calibration → logbook → PM/qualification) → 13. Dashboards (QA home: overdue calibrations, pending approvals, training due, docs due for review) → 14. Reports/exports (training record PDF, equipment history, audit-trail export)

**Phase 1.5** — WhatsApp notifications, QRX rooms/materials, assessments (TRN-6)

**Phase 2 (post design-partner go-live)** — Deviations, CAPA, Change Control (workflow engine already exists — these are mostly forms + flows + linkages)

**Phase 3** — Audits, Complaints, NCR/OOS, Supplier Quality
**Later (paying-customer-driven)** — Risk (ICH Q9), Validation tracking, APQR, metrics packs

## 9. Success Metrics

- **Leading:** design partner creates ≥ 80% of new SOP approvals in-system within 30 days of go-live; ≥ 70% of equipment log entries via QR within 60 days; zero audit-trail gaps in weekly self-check export.
- **Lagging:** design partner's next external audit passes with no software-attributed observations; 2 additional paying tenants within 6 months of v1; support tickets < 5/week/tenant after month 2.

## 10. Commercial Guardrails (for Varun — not client-facing)

- Do not begin Phase 0 until the design-partner agreement is signed: staged funding, reference-customer commitment, and their SOP index + sample forms delivered (they define final field lists).
- Any scope addition post-signing requires a scope removal or timeline/fee change — put this line in the agreement.
- Materials/inventory expansion requests → quoted as a separate product, never absorbed.

## 11. Open Questions (blocking = must answer before Phase 1 module builds; Phase 0 can start once deal is signed)

| # | Question | Who answers | Blocking? |
|---|---|---|---|
| 1 | Company type (manufacturer/trader/lab/device) and markets served | Client | Yes — validates entire product frame |
| 2 | Trigger event (483 / customer audit / certification) and any hard deadline | Client | Yes — sets timeline |
| 3 | Module priority ranking from client's QA head | Client QA | Yes — confirms v1 scope |
| 4 | E-sign strictness: PIN re-entry acceptable, or full password each time? | Client QA head | Yes (PLT-3 config) |
| 5 | Equipment count, room count, user count | Client | Yes — sizing & rollout plan |
| 6 | Cloud SaaS acceptable, or on-prem demanded? Data residency (India region)? | Client IT/QA | Yes — deployment architecture |
| 7 | Plant Wi-Fi/mobile coverage in all production areas | Client | Yes — validates no-offline decision |
| 8 | Label durability environment (washdown areas? autoclaves?) → label material choice | Client | No |
| 9 | ERP in use (Tally/SAP B1/Marg) — any integration expectation? | Client | No — P2 |
| 10 | Historical data migration expectations (old SOPs, past records) | Client | No — affects rollout, not build |
| 11 | Budget range and staged-payment agreement | Client + brother | Yes — gate for Phase 0 |

## 12. How to Use This Spec with Claude Code

1. Place this file in the repo root as `SPEC.md`; create a `CLAUDE.md` pointing to it with stack conventions and the rule: *"Every implemented requirement must reference its ID (e.g., EQP-6) in code comments and test names."*
2. Work Phase 0 top-to-bottom; do not start any module before Phase 0's definition-of-done demo passes.
3. Per session: pick one PLT/module ID group → have Claude Code write the data model + API + tests first, UI second.
4. Keep `/validation-pack/` updated per release (§5.5) — it is a sales asset, not overhead.
