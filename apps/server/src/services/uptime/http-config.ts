import type { UptimeMonitorRow, apiCreateUptimeMonitor, apiUpdateUptimeMonitor } from "@pulsy/db";
import { apiHttpRequest } from "@pulsy/db/validation-http";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { decrypt, encrypt } from "../../lib/crypto";
import type { Translator } from "../../lib/i18n";

type ConfigurationInput = Pick<z.output<typeof apiCreateUptimeMonitor>, "requestConfig" | "httpAssertions" | "redirectPolicy">;

/** Omission preserves the payload; null clears it; an object fully replaces it. */
export function httpConfigPatch(
	input: ConfigurationInput | z.output<typeof apiUpdateUptimeMonitor>,
	method: string,
	t: Translator,
	existingCipher?: string | null,
) {
	const effective = input.requestConfig === undefined
		? existingCipher ? apiHttpRequest.parse(JSON.parse(decrypt(existingCipher))) : null
		: input.requestConfig;
	if (effective?.body !== undefined && method !== "POST") {
		throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.httpBodyMethod") });
	}
	return {
		...(input.requestConfig !== undefined ? {
			requestCipher: input.requestConfig === null
				? null
				: encrypt(JSON.stringify(apiHttpRequest.parse(input.requestConfig))),
		} : {}),
		...(input.httpAssertions !== undefined ? { httpAssertions: input.httpAssertions } : {}),
		...(input.redirectPolicy !== undefined ? { redirectPolicy: input.redirectPolicy } : {}),
	};
}

/** Write-only request credentials cannot silently move to a different origin. */
export function assertCredentialOrigin(
	existingCipher: string | null | undefined,
	currentUrl: string,
	nextUrl: string | undefined,
	requestConfig: unknown,
	t: Translator,
): void {
	if (!existingCipher || nextUrl === undefined || requestConfig !== undefined) return;
	const origin = (value: string) => {
		try { return new URL(value).origin; } catch { return null; }
	};
	if (origin(nextUrl) !== origin(currentUrl)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.httpCredentialOrigin") });
	}
}

/** Remove stored ciphertext from an otherwise prepared projection. */
export function maskMonitor<T extends { requestCipher: string | null }>(
	monitor: T,
): Omit<T, "requestCipher"> & { requestConfigured: boolean } {
	const { requestCipher, ...safe } = monitor;
	return { ...safe, requestConfigured: Boolean(requestCipher) };
}

/** Owner projection: newly added persistence fields remain private by default. */
export function toOwnerMonitor(m: UptimeMonitorRow) {
	return {
		uptimeMonitorId: m.uptimeMonitorId,
		name: m.name,
		monitorType: m.monitorType,
		url: m.url,
		method: m.method,
		networkConfig: m.networkConfig,
		expectedStatus: m.expectedStatus,
		expectedStatuses: m.expectedStatuses,
		tlsMonitoringEnabled: m.tlsMonitoringEnabled,
		timeout: m.timeout,
		interval: m.interval,
		active: m.active,
		status: m.status,
		httpStatus: m.httpStatus,
		responseTime: m.responseTime,
		lastCheckedAt: m.lastCheckedAt,
		nextCheckAt: m.nextCheckAt,
		tlsExpiresAt: m.tlsExpiresAt,
		tlsExpiresInDays: m.tlsExpiresInDays,
		failureThreshold: m.failureThreshold,
		uptimePercentage: m.uptimePercentage,
		tags: m.tags,
		isPublic: m.isPublic,
		statusPageTitle: m.statusPageTitle,
		statusPageDescription: m.statusPageDescription,
		createdAt: m.createdAt,
		latencyPolicy: m.latencyPolicy,
		httpAssertions: m.httpAssertions,
		redirectPolicy: m.redirectPolicy,
		requestConfigured: Boolean(m.requestCipher),
	};
}
