// ---------------------------------------------------------------------------
// Read-only egress-policy audit (coverage-excluded runner).
//
// Lists stored monitors, notification channels and monitor templates whose
// destination the strict egress policy (lib/ssrf.ts) now rejects, so an
// operator can review them. It never inserts, updates or deletes anything:
// flagged monitors keep running under whatever policy the server is started
// with until the operator decides. The verdict is always computed against the
// strict policy (private networks denied), even if this deployment sets
// MONITOR_ALLOW_PRIVATE_NETWORKS=true, to help operators identify private destinations even when they are allowed.
//
// Output contains ids, owner ids, types and hostnames only — never full URLs,
// paths, query strings or headers (webhook URLs carry credentials).
//
// Run:  make audit-private-targets
//       (pnpm --filter @pulsy/server audit:private-targets inside the container)
// ---------------------------------------------------------------------------

import { asc } from "drizzle-orm";
import { db, uptimeMonitor, uptimeMonitorTemplate, uptimeNotificationChannel } from "@pulsy/db";

import { decryptNotificationChannelSecrets } from "./services/uptime/notification-channel-secrets";
import { safeErrorSummary } from "./lib/safe-error";
import { isMonitorHostAllowed, isMonitorUrlAllowed } from "./services/uptime/egress-input";

type Finding = { kind: "monitor" | "channel" | "template"; id: string; userId: string; type: string; host: string };

function hostOf(url: string): string {
	try { return new URL(url).hostname; } catch { return "(unparseable)"; }
}

async function main(): Promise<void> {
	process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";
	const findings: Finding[] = [];

	const monitors = await db.select({ id: uptimeMonitor.uptimeMonitorId, userId: uptimeMonitor.userId, type: uptimeMonitor.monitorType, url: uptimeMonitor.url, networkConfig: uptimeMonitor.networkConfig })
		.from(uptimeMonitor).orderBy(asc(uptimeMonitor.uptimeMonitorId));
	for (const monitor of monitors) {
		if (monitor.type === "http" && monitor.url && !await isMonitorUrlAllowed(monitor.url)) {
			findings.push({ kind: "monitor", id: monitor.id, userId: monitor.userId, type: "http", host: hostOf(monitor.url) });
		}
		const network = monitor.networkConfig;
		if ((monitor.type === "dns" || monitor.type === "tcp") && network && !await isMonitorHostAllowed(network.hostname, network.type)) {
			findings.push({ kind: "monitor", id: monitor.id, userId: monitor.userId, type: monitor.type, host: network.hostname });
		}
	}

	const channels = await db.select()
		.from(uptimeNotificationChannel).orderBy(asc(uptimeNotificationChannel.channelId));
	for (const channel of channels) {
		let url: string | null;
		try { url = decryptNotificationChannelSecrets(channel).webhookUrl; } catch { url = null; }
		if (!url || !/^https?:/i.test(url)) continue;
		if (!await isMonitorUrlAllowed(url)) findings.push({ kind: "channel", id: channel.channelId, userId: channel.userId, type: channel.channelType, host: hostOf(url) });
	}

	const templates = await db.select({ id: uptimeMonitorTemplate.id, userId: uptimeMonitorTemplate.userId, configuration: uptimeMonitorTemplate.configuration })
		.from(uptimeMonitorTemplate).orderBy(asc(uptimeMonitorTemplate.id));
	for (const template of templates) {
		const network = template.configuration.networkConfig;
		if (network && !await isMonitorHostAllowed(network.hostname, network.type)) {
			findings.push({ kind: "template", id: template.id, userId: template.userId, type: network.type, host: network.hostname });
		}
	}

	console.info(`[audit-private-targets] scanned ${monitors.length} monitors, ${channels.length} channels, ${templates.length} templates; ${findings.length} rejected by the strict egress policy (read-only, nothing changed).`);
	for (const finding of findings) console.info(JSON.stringify(finding));
}

main()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		console.error("[audit-private-targets] failed:", safeErrorSummary(error));
		process.exit(1);
	});
