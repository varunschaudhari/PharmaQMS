// PLT-3 / PLT-8: the tenant-configurable e-signature re-auth factor (SPEC.md §5.2).
// 'pin' is a documented future extension — see server esign.service.ts.
export enum CredentialType {
  PASSWORD = 'password',
  PIN = 'pin',
}
