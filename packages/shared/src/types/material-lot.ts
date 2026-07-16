import type { SignatureMeaning } from '../enums/signature-meaning';
import type { MaterialLotStatus } from '../enums/material-lot';

// QRX-2 (SPEC.md §7.4, Non-Goals §3): status verification only — lot code, material name,
// manufacturer/supplier, received date, and a disposition status. Deliberately NO quantity/UOM
// field anywhere on this type — that would be inventory, which is explicitly out of scope.
export interface MaterialLotData {
  id: string;
  tenantId: string;
  // PLT-5: e.g. LOT-001 — assigned by the numbering service at creation, never inline.
  lotCode: string;
  materialName: string;
  manufacturer: string | null;
  receivedDate: string;
  status: MaterialLotStatus;
  qr: { code: string; scanUrl: string } | null;
  createdAt: string;
}

// QRX-2: the latest QA disposition sign-off for a lot — sourced from PLT-3's signatures
// collection (findForEntity), not stored redundantly on the lot document itself.
export interface MaterialLotDispositionData {
  userFullName: string;
  meaning: SignatureMeaning;
  reason: string | null;
  signedAt: string;
}

// QRX-2: the scan-to-status view (SPEC.md §7.4) — a large color-coded status banner, disposition
// details (who signed, when), and material info. View-only for non-QA roles; `availableActions`
// includes 'change_status' only for an actor holding the materials:approve permission AND when a
// transition is actually possible (Approved/Rejected are terminal).
export interface MaterialLotScanData {
  id: string;
  lotCode: string;
  materialName: string;
  manufacturer: string | null;
  receivedDate: string;
  status: MaterialLotStatus;
  lastDisposition: MaterialLotDispositionData | null;
  availableActions: string[];
}

// QRX-2 (e): rejected-lots dashboard feed for QA.
export interface MaterialLotRejectedEntryData {
  lotId: string;
  lotCode: string;
  materialName: string;
  rejectedAt: string | null;
}
