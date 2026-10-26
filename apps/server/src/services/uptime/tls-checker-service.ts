import { isIP } from "node:net";
import * as tls from "node:tls";
import { assertAllowedUrl, assertOutboundUrlAllowed, isEgressFilteringEnabled, validatingLookup } from "../../lib/ssrf";

export interface TlsCertificateInfo {
	expiresAt: string;
	expiresInDays: number;
	issuer: string;
	valid: boolean;
}

function firstCertificateValue(value: string | string[] | undefined): string | null {
	if (!value) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
}

export const checkTlsCertificate = async (
	url: string,
	// The socket `timeout` below only fires on idle; this bounds the whole probe, so a
	// server that trickles bytes cannot hold a check slot open indefinitely.
	deadlineMs = 15_000,
): Promise<TlsCertificateInfo | null> => {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return null;
	}

	if (parsedUrl.protocol !== "https:") {
		return null;
	}

	// Egress policy: never open a probe socket to a disallowed host. Literal and
	// name checks run in every mode; resolution is checked when filtering is on
	// and pinned at connect time through `validatingLookup` below.
	try {
		assertAllowedUrl(url);
		if (isEgressFilteringEnabled()) await assertOutboundUrlAllowed(url);
	} catch {
		return null;
	}

	const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
	const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : 443;

	return new Promise<TlsCertificateInfo | null>((finish) => {
		const deadline = setTimeout(() => {
			socket.destroy();
			finish(null);
		}, deadlineMs);
		const resolve = (value: TlsCertificateInfo | null) => {
			clearTimeout(deadline);
			finish(value);
		};
		const socket = tls.connect(
			{
				host: hostname,
				port,
				rejectUnauthorized: false,
				servername: isIP(hostname) ? undefined : hostname,
				timeout: 10000,
				// Connect to the address that was validated, not a second DNS answer.
				lookup: validatingLookup as never,
			},
			() => {
				try {
					const cert = socket.getPeerCertificate();

					if (!cert || !cert.valid_to) {
						socket.destroy();
						resolve(null);
						return;
					}

					const expiresAt = new Date(cert.valid_to).toISOString();
					const now = new Date();
					const expiryDate = new Date(cert.valid_to);
					const diffMs = expiryDate.getTime() - now.getTime();
					const expiresInDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

					const issuerParts: string[] = [];
					if (cert.issuer) {
						const issuerOrg = firstCertificateValue(cert.issuer.O);
						const commonName = firstCertificateValue(cert.issuer.CN);
						if (issuerOrg) issuerParts.push(issuerOrg);
						if (commonName) issuerParts.push(commonName);
					}
					const issuer =
						issuerParts.length > 0 ? issuerParts.join(" - ") : "Unknown";

					const valid = expiresInDays > 0 && socket.authorized;

					socket.destroy();
					resolve({
						expiresAt,
						expiresInDays,
						issuer,
						valid,
					});
				} catch {
					socket.destroy();
					resolve(null);
				}
			},
		);

		socket.on("error", () => {
			socket.destroy();
			resolve(null);
		});

		socket.on("timeout", () => {
			socket.destroy();
			resolve(null);
		});
	});
};
