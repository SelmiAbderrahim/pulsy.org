import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
/**
 * Static descriptors for the public REST API (`/api/v1`) documentation page.
 *
 * Paths, methods, parameter names/types, and code samples are CODE-LITERAL (the
 * API contract is the same in every language). Only prose — summaries,
 * descriptions, parameter/field explanations — is translated, via the
 * `apiDocs` i18n namespace keys referenced here.
 *
 * The source of truth is `apps/server/src/api/v1/router.ts`; keep this in sync
 * with it (and with `docs/api/openapi.yaml`).
 *
 * @module components/uptime/api-docs/api-endpoints
 */

import { SERVER_URL } from "@/lib/api/trpc";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type AccessLevel = "read" | "write";

/** A path or query parameter. `descKey` resolves under `apiDocs`. */
export interface EndpointParam {
	name: string;
	in: "path" | "query";
	type: string;
	required: boolean;
	descKey: string;
}

export interface EndpointDescriptor {
	/** Stable id — also the anchor and the i18n key under `endpointDocs`. */
	id: string;
	method: HttpMethod;
	/** Display path, e.g. `/monitors/{id}/checks`. */
	path: string;
	access: AccessLevel;
	params: EndpointParam[];
	/** Render the shared request-body field table for this body shape. */
	body?: "create" | "update";
	/** Example request (curl). `{{base}}` is replaced with the live base URL. */
	requestSample: string;
	/** Example response body (valid JSON/text only). `{{base}}` is replaced with the live base URL. */
	responseSample: string;
	/** HTTP status line shown beside the response, kept out of the copied code. */
	responseStatus?: string;
}

/**
 * The live API base URL. `VITE_SERVER_URL` is set when the API lives on a
 * different origin; otherwise the API is same-origin (proxied), so we fall back
 * to the current window origin at call time.
 */
export function getApiBaseUrl(): string {
	const origin =
		SERVER_URL ||
		(typeof window !== "undefined" ? window.location.origin : "");
	return `${origin}/api/v1`;
}

const ID_PARAM: EndpointParam = {
	name: "id",
	in: "path",
	type: "string",
	required: true,
	descKey: "params.id",
};
const LIMIT_PARAM: EndpointParam = {
	name: "limit",
	in: "query",
	type: "integer",
	required: false,
	descKey: "params.limit",
};
const CURSOR_PARAM: EndpointParam = {
	name: "cursor",
	in: "query",
	type: "string",
	required: false,
	descKey: "params.cursor",
};
const DAYS_PARAM: EndpointParam = {
	name: "days",
	in: "query",
	type: "integer",
	required: false,
	descKey: "params.days",
};

// One illustrative monitor ("API health") carried through every example so each
// request/response pair agrees. IDs and timestamps are made up; they are not real
// data. `status` is "pending" until the first scheduled check has run.
const MONITOR_BASE = {
  id: "V1StGXR8_Z5jdHi6B-myT",
  name: "API health",
  monitorType: "http",
  url: "https://api.example.com/health",
  method: "GET",
  expectedStatus: 200,
  expectedStatuses: null,
  tlsMonitoringEnabled: true,
  httpAssertions: [],
  redirectPolicy: "follow",
  requestConfigured: false,
  latencyPolicy: null,
  consecutiveSlow: 0,
  consecutiveHealthy: 0,
  timeout: 10000,
  interval: 60,
  failureThreshold: DEFAULT_FAILURE_THRESHOLD,
  active: true,
  consecutiveFailures: 0,
  tags: ["api", "prod"],
  createdAt: "2026-06-20T10:00:00.000Z",
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** 201 body: nothing has been checked yet. */
const CREATED_SAMPLE = json({
  data: {
    ...MONITOR_BASE,
    status: "pending",
    httpStatus: null,
    responseTime: null,
    lastCheckedAt: null,
    nextCheckAt: "2026-06-20T10:01:00.000Z",
    tlsExpiresAt: null,
    tlsExpiresInDays: null,
    uptimePercentage: null,
  },
});

/** After checks have run (used by GET and check-now). */
const MONITOR_SAMPLE = json({
  data: {
    ...MONITOR_BASE,
    status: "up",
    httpStatus: 200,
    responseTime: 142,
    lastCheckedAt: "2026-06-20T10:05:00.000Z",
    nextCheckAt: "2026-06-20T10:06:00.000Z",
    tlsExpiresAt: "2026-09-01T00:00:00.000Z",
    tlsExpiresInDays: 73,
    uptimePercentage: 99.98,
  },
});

/** PATCH { "interval": 300, "active": false } applied to the monitor above at 10:10. */
const UPDATED_SAMPLE = json({
  data: {
    ...MONITOR_BASE,
    interval: 300,
    active: false,
    status: "up",
    httpStatus: 200,
    responseTime: 142,
    lastCheckedAt: "2026-06-20T10:05:00.000Z",
    nextCheckAt: "2026-06-20T10:15:00.000Z",
    tlsExpiresAt: "2026-09-01T00:00:00.000Z",
    tlsExpiresInDays: 73,
    uptimePercentage: 99.98,
  },
});

export const MONITOR_OBJECT_SAMPLE = MONITOR_SAMPLE;

/**
 * One monitor of every type, valid against `apiMonitorManifest`
 * (`packages/db/src/schema/monitor-manifest.ts`) and identical to the
 * `MonitorManifest` example in `docs/api/openapi.yaml`.
 */
export const MANIFEST_SAMPLE = json({
  "format": "pulsy-monitor-configuration",
  "version": 1,
  "monitors": [
    {
      "key": "api-health",
      "type": "http",
      "name": "API health",
      "url": "https://api.example.com/health",
      "method": "GET",
      "expectedStatus": 200,
      "timeout": 10000,
      "interval": 60,
      "failureThreshold": 3,
      "redirectPolicy": "follow",
      "active": true,
      "tags": [
        "api"
      ],
      "channelIds": [
        "ch_ops_email"
      ]
    },
    {
      "key": "dns-www",
      "type": "dns",
      "name": "www A record",
      "configuration": {
        "type": "dns",
        "hostname": "www.example.com",
        "recordType": "A",
        "mode": "matches",
        "expected": [
          "203.0.113.10"
        ]
      },
      "timeout": 10000,
      "interval": 300,
      "failureThreshold": 2,
      "active": true,
      "tags": [
        "dns"
      ]
    },
    {
      "key": "tcp-postgres",
      "type": "tcp",
      "name": "Postgres port",
      "configuration": {
        "type": "tcp",
        "hostname": "db.example.com",
        "port": 5432
      },
      "timeout": 5000,
      "interval": 60,
      "failureThreshold": 3,
      "active": true,
      "tags": [
        "db"
      ]
    },
    {
      "key": "nightly-backup",
      "type": "heartbeat",
      "name": "Nightly backup",
      "interval": 86400,
      "graceSeconds": 1800,
      "active": true,
      "tags": [
        "cron"
      ]
    },
    {
      "key": "web-01",
      "type": "server",
      "name": "web-01",
      "interval": 60,
      "active": true,
      "tags": [
        "linux"
      ],
      "thresholds": {
        "cpu": 90,
        "memory": 85,
        "disk": 80
      },
      "excludedFilesystems": [
        "/snap"
      ]
    }
  ]
});

/** Public, unauthenticated status-page projection (abbreviated). */
export const STATUS_PAGE_SAMPLE = `curl {{origin}}/api/status/pages/$PUBLIC_KEY/status.json
{ "version": 1, "title": "Example status", "description": null, "overallStatus": "operational", "monitors": [], "announcements": [] }`;

/** A rate-limited response: headers, then the JSON error body. */
export const RATE_LIMITED_SAMPLE = `HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1792231260

{ "error": { "code": "rate_limited", "message": "Too many requests. Retry after 42 seconds." } }`;

const PREVIEW_SAMPLE = json({
  manifest: { format: "pulsy-monitor-configuration", version: 1, monitors: JSON.parse(MANIFEST_SAMPLE).monitors },
  warnings: [{ key: "nightly-backup", field: "heartbeatActivation" }, { key: "web-01", field: "serverToken" }],
  revision: "3f1c9a7e2b8d4f6a0c5e1b9d7a3f2e8c4b6d0a9f1e7c3b5d8a2f4e6c0b9d1a7e",
  counts: { create: 5, update: 0, unchanged: 0, rejected: 0 },
  entries: ["api-health", "dns-www", "tcp-postgres", "nightly-backup", "web-01"].map(key => ({ key, action: "create", changes: [], reasons: [] })),
});

/** Grouped for display: monitor CRUD first, then per-monitor data. */
export const ENDPOINT_GROUPS: {
	titleKey: string;
	endpoints: EndpointDescriptor[];
}[] = [
	{
		titleKey: "groups.monitors",
		endpoints: [
			{
				id: "metrics", method: "GET", path: "/metrics", access: "read",
				params: [{ name: "monitorIds", in: "query", type: "string", required: false, descKey: "params.monitorIds" }],
				requestSample: `curl "{{base}}/metrics" -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: `# HELP pulsy_monitor_status Stored health: -1 unknown, 0 down, 1 up, 2 degraded. Use fresh to exclude stale state.
# TYPE pulsy_monitor_status gauge
pulsy_monitor_status{monitor_id="V1StGXR8_Z5jdHi6B-myT"} 1
pulsy_monitor_fresh{monitor_id="V1StGXR8_Z5jdHi6B-myT"} 1
pulsy_monitor_duration_seconds{monitor_id="V1StGXR8_Z5jdHi6B-myT"} 0.142`,
			},
			{
				id: "listMonitors",
				method: "GET",
				path: "/monitors",
				access: "read",
				params: [LIMIT_PARAM, CURSOR_PARAM],
				requestSample: `curl "{{base}}/monitors?limit=20" \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: json({ data: [JSON.parse(MONITOR_SAMPLE).data], nextCursor: null }),
			},
			{
				id: "createMonitor",
				method: "POST",
				path: "/monitors",
				access: "write",
				params: [],
				body: "create",
				requestSample: `curl -X POST {{base}}/monitors \\
  -H "Authorization: Bearer $PULSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "API health",
    "url": "https://api.example.com/health",
    "method": "GET",
    "interval": 60,
    "tags": ["api", "prod"]
  }'`,
				responseStatus: "201 Created",
				responseSample: CREATED_SAMPLE,
			},
			{
				id: "getMonitor",
				method: "GET",
				path: "/monitors/{id}",
				access: "read",
				params: [ID_PARAM],
				requestSample: `curl {{base}}/monitors/$ID \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: MONITOR_SAMPLE,
			},
			{
				id: "updateMonitor",
				method: "PATCH",
				path: "/monitors/{id}",
				access: "write",
				params: [ID_PARAM],
				body: "update",
				requestSample: `curl -X PATCH {{base}}/monitors/$ID \\
  -H "Authorization: Bearer $PULSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "interval": 300, "active": false }'`,
				responseSample: UPDATED_SAMPLE,
			},
			{
				id: "deleteMonitor",
				method: "DELETE",
				path: "/monitors/{id}",
				access: "write",
				params: [ID_PARAM],
				requestSample: `curl -X DELETE {{base}}/monitors/$ID \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: `{ "data": { "id": "V1StGXR8_Z5jdHi6B-myT", "deleted": true } }`,
			},
			{
				id: "checkNow",
				method: "POST",
				path: "/monitors/{id}/check-now",
				access: "write",
				params: [ID_PARAM],
				requestSample: `curl -X POST {{base}}/monitors/$ID/check-now \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: MONITOR_SAMPLE,
			},
		],
	},
	{
		titleKey: "groups.data",
		endpoints: [
			{
				id: "listChecks",
				method: "GET",
				path: "/monitors/{id}/checks",
				access: "read",
				params: [ID_PARAM, LIMIT_PARAM, CURSOR_PARAM],
				requestSample: `curl "{{base}}/monitors/$ID/checks?limit=20" \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: `{
  "data": [
    {
      "id": "kQ3x9Zp1Vt8Lm2Nc5RaWd",
      "status": "up",
      "httpStatus": 200,
      "responseTime": 142,
      "errorMessage": null,
      "errorCode": null,
      "errorLabel": null,
      "createdAt": "2026-06-20T10:00:00.000Z"
    },
    {
      "id": "Pz2Kc8Wm4Rt1Yb7Nd3QeF",
      "status": "down",
      "httpStatus": null,
      "responseTime": null,
      "errorMessage": "dns_not_found",
      "errorCode": "dns_not_found",
      "errorLabel": "DNS lookup failed — domain not found (NXDOMAIN)",
      "createdAt": "2026-06-20T09:55:00.000Z"
    }
  ],
  "nextCursor": null
}`,
			},
			{
				id: "listIncidents",
				method: "GET",
				path: "/monitors/{id}/incidents",
				access: "read",
				params: [ID_PARAM, LIMIT_PARAM, CURSOR_PARAM],
				requestSample: `curl "{{base}}/monitors/$ID/incidents?limit=20" \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: `{
  "data": [
    {
      "id": "Hy7Tn4Bs0JeUf6GoPxIqE",
      "status": "resolved",
      "startedAt": "2026-06-18T02:11:00.000Z",
      "resolvedAt": "2026-06-18T02:19:00.000Z",
      "durationSeconds": 480,
      "cause": "connection_timeout",
      "causeCode": "connection_timeout",
      "causeLabel": "Connection timed out",
      "expectedAt": null,
      "notifiedAt": "2026-06-18T02:11:04.000Z"
    }
  ],
  "nextCursor": null
}`,
			},
			{
				id: "getStats",
				method: "GET",
				path: "/monitors/{id}/stats",
				access: "read",
				params: [ID_PARAM, DAYS_PARAM],
				requestSample: `curl "{{base}}/monitors/$ID/stats?days=30" \\
  -H "Authorization: Bearer $PULSY_API_KEY"`,
				responseSample: json({
  data: {
    uptimePercentage: 99.98,
    totalChecks: 8640,
    successfulChecks: 8638,
    degradedChecks: 0,
    failedChecks: 2,
    avgResponseTime: 142,
    minResponseTime: 88,
    maxResponseTime: 1203,
    p95ResponseTime: 240,
  },
}),
			},
		],
	},
	{
		titleKey: "groups.configuration",
		endpoints: [
			{
				id: "exportConfiguration",
				method: "POST",
				path: "/configuration/export",
				access: "read",
				params: [],
				requestSample: `curl -X POST {{base}}/configuration/export \\
  -H "Authorization: Bearer $PULSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "monitorIds": ["V1StGXR8_Z5jdHi6B-myT"] }'`,
				responseSample: json({
  manifest: { format: "pulsy-monitor-configuration", version: 1, monitors: [JSON.parse(MANIFEST_SAMPLE).monitors[0]] },
  warnings: [],
}),
			},
			{
				id: "previewConfiguration",
				method: "POST",
				path: "/configuration/preview",
				access: "read",
				params: [],
				requestSample: `jq -n --rawfile text manifest.json '{text: $text}' > preview.json
curl -X POST {{base}}/configuration/preview \\
  -H "Authorization: Bearer $PULSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data @preview.json`,
				responseSample: PREVIEW_SAMPLE,
			},
			{
				id: "applyConfiguration",
				method: "POST",
				path: "/configuration/apply",
				access: "write",
				params: [],
				requestSample: `jq -n --rawfile text manifest.json --arg revision "$REVISION" '{text: $text, revision: $revision}' > apply.json
curl -X POST {{base}}/configuration/apply \\
  -H "Authorization: Bearer $PULSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data @apply.json`,
				responseSample: json({ counts: { create: 5, update: 0, unchanged: 0, rejected: 0 } }),
			},
		],
	},
];

/** Shared request-body fields for create/update (config only). */
export const BODY_FIELDS: {
	name: string;
	type: string;
	/** Required only on create. */
	requiredOnCreate: boolean;
}[] = [
	{ name: "name", type: "string", requiredOnCreate: true },
	{ name: "url", type: "string", requiredOnCreate: true },
	{ name: "method", type: '"GET" | "HEAD" | "POST"', requiredOnCreate: false },
	{ name: "expectedStatus", type: "integer", requiredOnCreate: false },
	{ name: "expectedStatuses", type: "string | null", requiredOnCreate: false },
	{ name: "tlsMonitoringEnabled", type: "boolean", requiredOnCreate: false },
	{ name: "timeout", type: "integer (ms)", requiredOnCreate: false },
	{ name: "interval", type: "integer (s)", requiredOnCreate: false },
	{ name: "latencyPolicy", type: "object | null", requiredOnCreate: false },
	{ name: "failureThreshold", type: "integer", requiredOnCreate: false },
	{ name: "active", type: "boolean", requiredOnCreate: false },
	{ name: "tags", type: "string[]", requiredOnCreate: false },
];
