// PLT-1: expiryDays <= 0 means the tenant's password policy has no expiry.
export function isPasswordExpired(passwordChangedAt: Date, expiryDays: number): boolean {
  if (!expiryDays || expiryDays <= 0) {
    return false;
  }
  const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
  return Date.now() - passwordChangedAt.getTime() > expiryMs;
}
