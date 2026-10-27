import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ errors: [] as string[], authorizedConnections: 0 }));
vi.mock("node:tls", async (importActual) => {
	const actual = await importActual<typeof import("node:tls")>();
	return {
		...actual,
		connect: (...args: Parameters<typeof actual.connect>) => {
			const socket = actual.connect(...args);
			socket.on("error", (error: NodeJS.ErrnoException) => observed.errors.push(error.code ?? ""));
			socket.on("secureConnect", () => observed.authorizedConnections++);
			return socket;
		},
	};
});

import { checkTlsCertificate } from "../tls-checker-service";

// OpenSSL ships in the server container via ca-certificates. Generate isolated
// fixtures at runtime so no private keys or expiring valid certs enter the repo.
const directory = mkdtempSync(join(tmpdir(), "pulsy-tls-test-"));
const fixture = (name: string) => readFileSync(join(directory, name), "utf8");
const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
let ca: string;
let key: string;
let server: tls.Server;
let applicationBytes = 0;
let originalCAs: string[];

beforeAll(() => {
	openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "ca.pem", "-days", "365", "-subj", "/CN=Pulsy TLS test CA", "-addext", "subjectAltName=IP:127.0.0.1");
	openssl("req", "-new", "-key", "key.pem", "-out", "leaf.csr", "-subj", "/CN=Pulsy TLS fixture");
	writeFileSync(join(directory, "extensions"), "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
	openssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "key.pem", "-set_serial", "2", "-out", "expired.pem", "-days", "-1", "-extfile", "extensions");
	writeFileSync(join(directory, "extensions"), "subjectAltName=DNS:other.test\nbasicConstraints=CA:FALSE\n");
	openssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "key.pem", "-set_serial", "3", "-out", "mismatch.pem", "-days", "365", "-extfile", "extensions");
	ca = fixture("ca.pem");
	key = fixture("key.pem");
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

beforeEach(() => {
	vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
	originalCAs = tls.getCACertificates("default");
	observed.errors = [];
	observed.authorizedConnections = 0;
	applicationBytes = 0;
});

afterEach(async () => {
	tls.setDefaultCACertificates(originalCAs);
	vi.unstubAllEnvs();
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function probe(cert: string) {
	server = tls.createServer({ key, cert }, (socket) => {
		socket.on("data", (data: Buffer) => { applicationBytes += data.length; });
		socket.on("error", () => {});
	});
	server.on("tlsClientError", () => {});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return checkTlsCertificate(`https://127.0.0.1:${port}/private?token=never-sent`);
}

it("rejects a self-signed handshake while retaining untrusted certificate expiry", async () => {
	const result = await probe(ca);
	expect(result).toMatchObject({ valid: false, issuer: "Pulsy TLS test CA" });
	expect(result?.expiresInDays).toBeGreaterThan(360);
	expect(observed.errors).toEqual(["DEPTH_ZERO_SELF_SIGNED_CERT"]);
	expect(observed.authorizedConnections).toBe(0);
	expect(applicationBytes).toBe(0);
});

it("rejects an expired trusted leaf while retaining its expiry", async () => {
	tls.setDefaultCACertificates([...originalCAs, ca]);
	const result = await probe(fixture("expired.pem"));
	expect(result).toMatchObject({ valid: false, issuer: "Pulsy TLS test CA" });
	expect(result?.expiresInDays).toBeLessThan(0);
	expect(observed.errors).toEqual(["CERT_HAS_EXPIRED"]);
	expect(observed.authorizedConnections).toBe(0);
	expect(applicationBytes).toBe(0);
});

it("reports a trusted certificate as valid after authorization", async () => {
	tls.setDefaultCACertificates([...originalCAs, ca]);
	const result = await probe(ca);
	expect(result?.valid).toBe(true);
	expect(observed.errors).toEqual([]);
	expect(observed.authorizedConnections).toBe(1);
	expect(applicationBytes).toBe(0);
});

it("rejects a trusted certificate for another hostname while retaining its expiry", async () => {
	tls.setDefaultCACertificates([...originalCAs, ca]);
	const result = await probe(fixture("mismatch.pem"));
	expect(result).toMatchObject({ valid: false, issuer: "Pulsy TLS test CA" });
	expect(result?.expiresInDays).toBeGreaterThan(360);
	expect(observed.errors).toEqual(["ERR_TLS_CERT_ALTNAME_INVALID"]);
	expect(observed.authorizedConnections).toBe(0);
	expect(applicationBytes).toBe(0);
});
