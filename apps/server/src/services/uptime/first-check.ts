/** Bulk creates spread first checks over at most this window to avoid a thundering herd. */
export const FIRST_CHECK_JITTER_MS = 5_000;

/**
 * `nextCheckAt` for a monitor whose first result is needed now: create, resume,
 * or a change to what is checked (URL, method, interval, target). The scheduler
 * runs a due `nextCheckAt` immediately instead of waiting a full interval.
 */
export function firstCheckAt(batchSize = 1, now = Date.now()): string {
  return new Date(now + (batchSize > 1 ? Math.floor(Math.random() * FIRST_CHECK_JITTER_MS) : 0)).toISOString();
}
