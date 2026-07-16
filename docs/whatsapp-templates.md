# WhatsApp Business Templates (PLT-6-WA)

WhatsApp Business API requires every outbound template message to be **pre-approved by Meta**
before it can be sent. This document lists the exact template bodies PharmaQMS needs, ready for
submission in Meta Business Manager (WhatsApp Manager → Message Templates → Create Template).

Each template maps 1:1 to an internal `WhatsAppTemplateKey` (`packages/shared/src/enums/whatsapp-template-key.ts`)
and a parameter-building function (`packages/shared/src/whatsapp-templates.ts`). **The parameter
order below is load-bearing** — Meta templates use positional `{{1}}`, `{{2}}`, ... placeholders,
and the build functions emit params in exactly the order shown here. If a template's wording is
edited after Meta approval, the parameter *count and order* must not change without also updating
the corresponding builder function.

If a tenant's WhatsApp Business Account has these templates approved under different names, set
`Tenant.settings.whatsappTemplateNames` (via `PATCH /tenants/:id/settings`) to override the name
per key — no code change needed, since `resolveWhatsAppTemplateName()` checks the tenant override
before falling back to the names below.

**Category:** all six are `UTILITY` (transactional/operational — the eligible category for
account-triggered notifications like these, as opposed to `MARKETING`).
**Language:** `en` (English) — configurable per deployment via `WHATSAPP_TEMPLATE_LANGUAGE`.

---

## 1. `pharmaqms_task_assigned`

**Event:** PLT-4 workflow step assigned (submit, non-final approval, reject-to-earlier-step, or
reassign) — SPEC.md §6.1 PLT-6 "assigned".

**Body:**
```
PharmaQMS: A new approval task is waiting for you. {{1}} {{2}} requires your action at step "{{3}}". Please log in to review.
```

| # | Parameter | Example (submission sample) |
|---|---|---|
| 1 | Entity type | `DocumentVersion` |
| 2 | Entity id / number | `SOP-QA-001` |
| 3 | Workflow step name | `Dept Head Review` |

Builder: `taskAssignedWhatsAppParams(entityType, entityId, stepName)`.

---

## 2. `pharmaqms_approval_completed`

**Event:** PLT-4 workflow instance reaches its final `APPROVED` status — SPEC.md §6.1 PLT-6
"approved". Sent to the original submitter.

**Body:**
```
PharmaQMS: {{1}} {{2}} has completed its approval workflow. Final approval by {{3}}.
```

| # | Parameter | Example |
|---|---|---|
| 1 | Entity type | `DocumentVersion` |
| 2 | Entity id / number | `SOP-QA-001` |
| 3 | Final approver's full name | `Quinn Qahead` |

Builder: `approvalCompletedWhatsAppParams(entityType, entityId, actorFullName)`.

---

## 3. `pharmaqms_calibration_due`

**Event:** EQP-4 calibration due-soon (within the 30-day window) — sent to the equipment's
department head.

**Body:**
```
PharmaQMS: Calibration due soon for {{1}} ({{2}}). Due date: {{3}}. Please schedule calibration.
```

| # | Parameter | Example |
|---|---|---|
| 1 | Equipment code | `EQP-0001` |
| 2 | Equipment name | `Autoclave` |
| 3 | Due date (YYYY-MM-DD) | `2026-08-01` |

Builder: `calibrationDueWhatsAppParams(equipmentCode, equipmentName, dueDate, overdue: false)`.

---

## 4. `pharmaqms_calibration_overdue`

**Event:** EQP-4 calibration overdue — same recipient/trigger as #3, but the due date has already
passed. A **separate** template (not a parameter flag) because Meta template approval is per exact
wording, and the overdue wording is deliberately more urgent.

**Body:**
```
PharmaQMS ALERT: Calibration OVERDUE for {{1}} ({{2}}). Was due: {{3}}. Please take immediate action.
```

| # | Parameter | Example |
|---|---|---|
| 1 | Equipment code | `EQP-0001` |
| 2 | Equipment name | `Autoclave` |
| 3 | Original due date (YYYY-MM-DD) | `2026-01-01` |

Builder: `calibrationDueWhatsAppParams(equipmentCode, equipmentName, dueDate, overdue: true)` —
same function as #3, selects this template key when `overdue` is `true`.

---

## 5. `pharmaqms_training_overdue`

**Event:** TRN-5 overdue read-and-understood training. Sent to BOTH the trainee and their
department head — same wording for both (the template always describes the trainee in the third
person; only the notification's in-app title differs between the two recipients).

**Body:**
```
PharmaQMS: {{1}}'s read-and-understood training for {{2}} — {{3}} is overdue. Please complete it as soon as possible.
```

| # | Parameter | Example |
|---|---|---|
| 1 | Trainee's full name | `Olive Operator` |
| 2 | Document number | `SOP-QA-001` |
| 3 | Document title | `Cleaning of pH meters` |

Builder: `trainingOverdueWhatsAppParams(userFullName, docNumber, documentTitle)`.

---

## 6. `pharmaqms_document_review_due`

**Event:** DOC-6 periodic review due/overdue. Sent to the document's author. One template covers
both due-soon and overdue (unlike calibration) since the wording is neutral either way — the due
date itself communicates urgency.

**Body:**
```
PharmaQMS: Periodic review due for {{1}} — {{2}}. Due date: {{3}}. Please reaffirm or revise.
```

| # | Parameter | Example |
|---|---|---|
| 1 | Document number | `SOP-QA-002` |
| 2 | Document title | `Change Control SOP` |
| 3 | Due date (YYYY-MM-DD) | `2026-09-01` |

Builder: `documentReviewDueWhatsAppParams(docNumber, title, dueDate)`.

---

## Submission checklist (Meta Business Manager)

For each of the six templates above:
1. WhatsApp Manager → Message Templates → Create Template.
2. Category: **Utility**. Name: exactly as listed (e.g. `pharmaqms_task_assigned`) unless a tenant
   needs a different name (see the tenant-override note at the top of this document).
3. Language: **English** (add more languages later if a tenant needs them — extend
   `WhatsAppConfig.defaultTemplateLanguage` / per-tenant language resolution at that point; v1 is
   English-only).
4. Body: paste verbatim from this document, including the `{{1}}`/`{{2}}`/`{{3}}` placeholders.
5. Sample values: use the "Example" column values above — Meta requires a sample per placeholder
   for review.
6. Submit for review. Meta typically approves utility templates within minutes to a few hours;
   rejected templates usually cite promotional language or missing sample values as the cause.

## What is NOT in this document

Provider credentials (WhatsApp Business phone number ID, permanent access token, app secret,
webhook verify token) are **never** part of a template submission and are **never** committed to
this repository — they are runtime environment variables only (`WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; see
`server/src/platform/notifications/config/whatsapp.config.ts`).
