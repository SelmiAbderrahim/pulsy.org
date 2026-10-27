# Check success, observed availability and coverage

Pulsy shows two different families of numbers. They answer different questions
and are intentionally not interchangeable.

| Name in the UI | Question | Formula | Where |
|---|---|---|---|
| **Check success** (30d / 90d / report window) | What share of the recorded checks passed? | `checks with status up ÷ all recorded checks`, 2 decimals, `null` with no checks | monitor list column, Overview, daily bars, SLA report (UI, PDF, email), public status page, `GET /api/v1/monitors*` (`uptimePercentage`), `GET /api/v1/monitors/{id}/stats` |
| **Average check success** | Across my monitors? | Mean of each monitor's 30-day check success; every monitor with recorded checks weighs the same, monitors without checks are excluded | dashboard card |
| **Observed availability** | How much of the *observed time* was up? | `up duration ÷ observed duration`; degraded and down both consume the budget | History tab, public history |
| **Coverage** | How much of the window was observed at all? | `observed duration ÷ (window − excluded maintenance)` | History tab, public history |

One function, `checkSuccessPercent()` in
`apps/server/src/services/uptime/stats-service.ts`, is the only place the
check-success ratio is computed. The list/dashboard (`getOwnedUptimeAggregates`),
Overview (`uptime.stats`), SLA report (`getMonitorStatsForWindow`), daily bars
(`getMonitorDailyUptime`, `getUptimeBarData`), public page and API all call it.

## Status accounting

- `up`, `degraded` and `down` are the only check statuses. `successful + degraded + down = total`
  everywhere those counts are shown (`uptime.stats` returns `upChecks`,
  `degradedChecks`, `downChecks`; SLA stats return `successfulChecks`,
  `degradedChecks`, `failedChecks`).
- Degraded counts as **not successful** but is shown separately, so a monitor
  with one Late and one Missed heartbeat reads "0 up · 1 degraded · 1 down",
  0 % check success.
- Paused monitors keep their history; they stop producing checks, so a long
  pause lowers coverage, not check success.
- Missing history is unknown. It is never counted as success or as failure.

## Windows and time zones

- Rolling windows are `now − N days … now`, UTC ISO timestamps.
- Daily bars and History rows use UTC calendar days; today is partial.
- SLA monthly reports use the previous UTC calendar month.
- Incident downtime in an SLA report is clipped to the report window.

## Heartbeats

A heartbeat does not run checks; it is judged when a deadline passes.

- New → no deadline passed yet (Pending).
- `expectedAt` passed, inside grace → **Late** (degraded) and one check sample.
- `expectedAt + grace` passed → **Down** (incident) and one check sample.
- A success resets the deadline to `receipt + interval`. Start without a
  completion never counts as success.
- Samples are written on receipts and on transitions, not on a timer, so a
  heartbeat that stays Down produces no further samples. Each observation covers
  at most one interval; the rest of a long outage is **unknown** in History
  rather than down. This is the preserved coverage gap, not a defect to hide.
- Resuming a paused heartbeat, or starting Pulsy after an outage longer than the
  grace period, starts a fresh interval instead of judging the stale deadline.

## What is not guaranteed

- Sub-threshold failures (below `failureThreshold`) lower check success but do
  not open an incident, so incident downtime and check success need not agree.
- Legacy HTTP monitors that return a sub-400 status other than the expected one
  are `degraded` and stay in the denominator.
