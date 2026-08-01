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
	/** Example response body. `{{base}}` is replaced with the live base URL. */
	responseSample: string;
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

const MONITOR_SAMPLE = `{
  "data": {
    "id": "V1StGXR8_Z5jdHi6B-myT",
    "name": "Marketing site",
    "url": "https://example.com",
    "method": "GET",
    "expectedStatus": 200,
    "timeout": 10000,
    "interval": 300,
    "failureThreshold": 3,
    "active": true,
    "status": "up",
    "httpStatus": 200,
    "responseTime": 142,
    "lastCheckedAt": "2026-06-20T10:00:00.000Z",
    "nextCheckAt": "2026-06-20T10:05:00.000Z",
    "tlsExpiresAt": "2026-09-01T00:00:00.000Z",
    "tlsExpiresInDays": 73,
    "consecutiveFailures": 0,
    "uptimePercentage": 99.98,
    "tags": ["prod"],
    "createdAt": "2026-06-01T09:00:00.000Z"
  }
}`;

export const MONITOR_OBJECT_SAMPLE = MONITOR_SAMPLE;

/** Grouped for display: monitor CRUD first, then per-monitor data. */
export const ENDPOINT_GROUPS: {
	titleKey: string;
	endpoints: EndpointDescriptor[];
}[] = [
	{
		titleKey: "groups.monitors",
		endpoints: [
			{
				id: "listMonitors",
				method: "GET",
				path: "/monitors",
				access: "read",
				params: [LIMIT_PARAM, CURSOR_PARAM],
				requestSample: `curl "{{base}}/monitors?limit=20" \\
  -H "Authorization: Bearer pul_…"`,
				responseSample: `{
  "data": [
    { "id": "V1StGXR8_Z5jdHi6B-myT", "name": "Marketing site", "status": "up", … }
  ],
  "nextCursor": "MjA"
}`,
			},
			{
				id: "createMonitor",
				method: "POST",
				path: "/monitors",
				access: "write",
				params: [],
				body: "create",
				requestSample: `curl -X POST {{base}}/monitors \\
  -H "Authorization: Bearer pul_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "API health",
    "url": "https://api.example.com/health",
    "method": "GET",
    "interval": 60,
    "tags": ["api", "prod"]
  }'`,
				responseSample: `HTTP/1.1 201 Created

${MONITOR_SAMPLE}`,
			},
			{
				id: "getMonitor",
				method: "GET",
				path: "/monitors/{id}",
				access: "read",
				params: [ID_PARAM],
				requestSample: `curl {{base}}/monitors/$ID \\
  -H "Authorization: Bearer pul_…"`,
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
  -H "Authorization: Bearer pul_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "interval": 300, "active": false }'`,
				responseSample: MONITOR_SAMPLE,
			},
			{
				id: "deleteMonitor",
				method: "DELETE",
				path: "/monitors/{id}",
				access: "write",
				params: [ID_PARAM],
				requestSample: `curl -X DELETE {{base}}/monitors/$ID \\
  -H "Authorization: Bearer pul_…"`,
				responseSample: `{ "data": { "id": "V1StGXR8_Z5jdHi6B-myT", "deleted": true } }`,
			},
			{
				id: "checkNow",
				method: "POST",
				path: "/monitors/{id}/check-now",
				access: "write",
				params: [ID_PARAM],
				requestSample: `curl -X POST {{base}}/monitors/$ID/check-now \\
  -H "Authorization: Bearer pul_…"`,
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
  -H "Authorization: Bearer pul_…"`,
				responseSample: `{
  "data": [
    {
      "id": "chk_8f2…",
      "status": "up",
      "httpStatus": 200,
      "responseTime": 142,
      "errorMessage": null,
      "createdAt": "2026-06-20T10:00:00.000Z"
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
  -H "Authorization: Bearer pul_…"`,
				responseSample: `{
  "data": [
    {
      "id": "inc_3a1…",
      "status": "resolved",
      "startedAt": "2026-06-18T02:11:00.000Z",
      "resolvedAt": "2026-06-18T02:19:00.000Z",
      "durationSeconds": 480,
      "cause": "Connection timed out"
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
  -H "Authorization: Bearer pul_…"`,
				responseSample: `{
  "data": {
    "uptimePercentage": 99.98,
    "totalChecks": 8640,
    "successfulChecks": 8638,
    "failedChecks": 2,
    "avgResponseTime": 142,
    "minResponseTime": 88,
    "maxResponseTime": 1203,
    "p95ResponseTime": 240
  }
}`,
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
	{ name: "timeout", type: "integer (ms)", requiredOnCreate: false },
	{ name: "interval", type: "integer (s)", requiredOnCreate: false },
	{ name: "failureThreshold", type: "integer", requiredOnCreate: false },
	{ name: "active", type: "boolean", requiredOnCreate: false },
	{ name: "tags", type: "string[]", requiredOnCreate: false },
];
