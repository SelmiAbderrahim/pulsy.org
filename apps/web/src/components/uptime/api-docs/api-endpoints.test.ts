import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINT_GROUPS, MONITOR_OBJECT_SAMPLE, type EndpointDescriptor } from "./api-endpoints";

const endpoints: EndpointDescriptor[] = ENDPOINT_GROUPS.flatMap((group) => group.endpoints);
const byId = (id: string) => endpoints.find((endpoint) => endpoint.id === id)!;
const requestBody = (endpoint: EndpointDescriptor) => JSON.parse(/-d '([\s\S]*?)'\s*$/.exec(endpoint.requestSample)![1]!) as Record<string, unknown>;
const monitorOf = (endpoint: EndpointDescriptor) => (JSON.parse(endpoint.responseSample) as { data: Record<string, unknown> }).data;

/** Property names of components.schemas.Monitor in the shipped spec (the file the page links to). */
function specMonitorProperties(): string[] {
	const text = readFileSync(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8");
	const block = text.split(/^    Monitor:\n/m)[1]?.split(/^    \w+:\n/m)[0] ?? "";
	return [...block.matchAll(/^        (\w+):/gm)].map((m) => m[1]!);
}

describe("API docs samples", () => {
	it("every response sample is machine-parseable, so the copy button copies code only", () => {
		for (const endpoint of endpoints.filter((e) => e.id !== "metrics")) {
			expect(() => JSON.parse(endpoint.responseSample), endpoint.id).not.toThrow();
		}
		expect(endpoints.map((e) => e.responseSample).join("\n")).not.toMatch(/HTTP\/1\.1|…|\.\.\./);
	});

	it("request samples use an environment variable, never a key-shaped literal", () => {
		for (const endpoint of endpoints) {
			expect(endpoint.requestSample, endpoint.id).toContain("$PULSY_API_KEY");
			expect(endpoint.requestSample, endpoint.id).not.toMatch(/pul_[A-Za-z0-9_-]+/);
		}
	});

	it("POST /monitors: the response describes the request and is truthfully pending", () => {
		const create = byId("createMonitor");
		const sent = requestBody(create);
		const got = monitorOf(create);
		for (const [key, value] of Object.entries(sent)) expect(got[key], key).toEqual(value);
		expect(create.responseStatus).toBe("201 Created");
		expect(got).toMatchObject({ status: "pending", httpStatus: null, responseTime: null, lastCheckedAt: null, uptimePercentage: null, active: true });
	});

	it("PATCH /monitors/{id}: every patched field changes in the response, nothing else is renamed", () => {
		const update = byId("updateMonitor");
		const sent = requestBody(update);
		const got = monitorOf(update);
		const before = monitorOf(byId("getMonitor"));
		for (const [key, value] of Object.entries(sent)) expect(got[key], key).toEqual(value);
		expect(got.active).toBe(false);
		// Same monitor throughout the page: identity fields agree across examples.
		for (const key of ["id", "name", "url", "tags", "createdAt"]) expect(got[key], key).toEqual(before[key]);
		for (const endpoint of [byId("createMonitor"), byId("getMonitor"), byId("checkNow")]) expect(monitorOf(endpoint).id).toBe(got.id);
	});

	it("the monitor object lists exactly the fields in the shipped OpenAPI Monitor schema", () => {
		const spec = specMonitorProperties().sort();
		expect(spec.length).toBeGreaterThan(20);
		for (const sample of [MONITOR_OBJECT_SAMPLE, byId("createMonitor").responseSample, byId("updateMonitor").responseSample]) {
			expect(Object.keys((JSON.parse(sample) as { data: object }).data).sort()).toEqual(spec);
		}
	});

	it("stats counts reconcile", () => {
		const stats = monitorOf(byId("getStats")) as unknown as { successfulChecks: number; degradedChecks: number; failedChecks: number; totalChecks: number; uptimePercentage: number };
		expect(stats.successfulChecks + stats.degradedChecks + stats.failedChecks).toBe(stats.totalChecks);
		expect(stats.uptimePercentage).toBe(Math.round((stats.successfulChecks / stats.totalChecks) * 10000) / 100);
	});
});

describe("shipped OpenAPI document lint", () => {
	const spec = readFileSync(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8");
	const schemaNames = new Set([...(spec.split(/^components:\n/m)[1]?.split(/^  schemas:\n/m)[1] ?? "").matchAll(/^    (\w+):\n/gm)].map((m) => m[1]!));
	const sectionNames = (section: string) => new Set([...(spec.split(new RegExp(`^  ${section}:\\n`, "m"))[1]?.split(/^  \w+:\n/m)[0] ?? "").matchAll(/^    (\w+):\n/gm)].map((m) => m[1]!));

	it("declares an OpenAPI 3.1 version, a server and bearer security", () => {
		expect(spec).toMatch(/^openapi: 3\.1\.\d+$/m);
		expect(spec).toMatch(/^servers:\n/m);
		expect(spec).toMatch(/bearerAuth:/);
	});

	it("resolves every local $ref to a component that exists", () => {
		const refs = [...spec.matchAll(/\$ref:\s*['"]?#\/components\/(\w+)\/(\w+)['"]?/g)];
		expect(refs.length).toBeGreaterThan(10);
		for (const [, kind, name] of refs) {
			const known = kind === "schemas" ? schemaNames : sectionNames(kind!);
			expect(known.has(name!), `#/components/${kind}/${name}`).toBe(true);
		}
	});

	it("has unique path keys and only uses declared tags", () => {
		const paths = [...spec.matchAll(/^  (\/\S*):\n/gm)].map((m) => m[1]!);
		expect(new Set(paths).size).toBe(paths.length);
		const declared = new Set([...(spec.split(/^tags:\n/m)[1]?.split(/^paths:/m)[0] ?? "").matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]!.trim()));
		for (const [, tag] of spec.matchAll(/^ {6}tags: \[(.+)\]$/gm)) expect(declared.has(tag!.replace(/['"]/g, "").trim()), tag).toBe(true);
	});

	it("documents DNS, TCP, heartbeat, agent, channel and status-page usage", () => {
		for (const needle of ['"type":"dns"', '"type":"tcp"', '"type":"heartbeat"', '"type":"server"', "channelIds", "/status/pages/{publicKey}/{format}"]) expect(spec, needle).toContain(needle);
	});
});
