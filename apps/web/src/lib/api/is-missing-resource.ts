/** Only an authoritative API status distinguishes absence from a failed fetch. */
export function isMissingResource(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return Boolean(data && typeof data === "object" &&
    (("code" in data && data.code === "NOT_FOUND") || ("httpStatus" in data && data.httpStatus === 404)));
}
