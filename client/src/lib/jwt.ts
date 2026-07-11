// Minimal base64url JWT payload decode — no signature verification (the server already
// verified it; the client only needs the claims to hydrate UI state).
export function decodeJwt<T>(token: string): T {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    throw new Error('Malformed JWT');
  }
  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const json = decodeURIComponent(
    atob(padded)
      .split('')
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
  return JSON.parse(json) as T;
}
