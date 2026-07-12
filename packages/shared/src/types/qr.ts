// PLT-7: an opaque short code mapping /s/:code -> a business entity (SPEC.md §6.1 PLT-7).
// entityCode/entityName are display snapshots taken at label creation (what gets printed on the
// physical label) — the QR service never joins across entity collections.
export interface QrCodeData {
  id: string;
  tenantId: string;
  code: string;
  entityType: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  isActive: boolean;
  // The URL encoded inside the QR image: {APP_BASE_URL}/s/{code}.
  scanUrl: string;
}

// What an authenticated scan resolves to — enough for the mobile router to pick the
// entity-type-specific view.
export interface QrResolutionData {
  code: string;
  entityType: string;
  entityId: string;
  entityCode: string;
  entityName: string;
}
