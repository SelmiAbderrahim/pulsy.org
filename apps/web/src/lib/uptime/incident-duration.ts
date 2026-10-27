/** Resolved duration is a recorded fact; open duration is a nonnegative estimate. */
export function incidentDuration(incident: { status: string; startedAt: string; durationSeconds: number | null }, now: number): number | null {
  if (incident.status === "resolved") {
    return incident.durationSeconds !== null && Number.isFinite(incident.durationSeconds) && incident.durationSeconds >= 0
      ? incident.durationSeconds : null;
  }
  const start = Date.parse(incident.startedAt);
  return incident.status === "ongoing" && Number.isFinite(start) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - start) / 1000)) : null;
}
