import type { AccessTokenPayload } from '@pharmaqms/shared';

function base64UrlEncode(input: string): string {
  const base64 = btoa(unescape(encodeURIComponent(input)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Test-only: builds a structurally valid (unsigned) JWT string so decodeJwt() can parse it.
// Never used outside tests — the real server always signs with a verified secret.
export function signFakeAccessTokenForTest(overrides: Partial<AccessTokenPayload> = {}): string {
  const payload: AccessTokenPayload = {
    sub: 'user-1',
    tenantId: 'tenant-1',
    roleId: 'role-1',
    email: 'user@example.com',
    fullName: 'Test User',
    permissions: [],
    isPlatformAdmin: false,
    type: 'access',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}
