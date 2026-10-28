/** Expiry selection must be a UTC calendar date strictly after today. */
export function isFutureUtcExpiry(value: string, now = Date.now()): boolean {
  const at = Date.parse(value);
  return Number.isFinite(at) && Math.floor(at / 86_400_000) > Math.floor(now / 86_400_000);
}
