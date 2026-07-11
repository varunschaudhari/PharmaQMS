// PLT-5: tenant-configurable numbering scheme for one entity type (e.g. 'SOP', 'EQP', 'TRN').
// Formats as {prefix}[-{departmentCode}][-{year}]-{paddedNumber}, e.g. SOP-QA-001, EQP-0042,
// TRN-2026-0113 (SPEC.md §6.1).
export interface NumberingSchemeData {
  id: string;
  tenantId: string;
  entityType: string;
  prefix: string;
  useDepartmentToken: boolean;
  paddingWidth: number;
  yearlyReset: boolean;
}

export interface GenerateNumberResponse {
  code: string;
}
