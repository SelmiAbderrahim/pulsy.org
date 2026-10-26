/** Consecutive failed active probes required to declare a new monitor Down. */
export const DEFAULT_FAILURE_THRESHOLD = 3;

/** One bounded deadline for HTTP, DNS and TCP monitor checks. */
export const MAX_MONITOR_TIMEOUT_MS = 60_000;
