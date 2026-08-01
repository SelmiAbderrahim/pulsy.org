import { vi } from "vitest";

// ---------------------------------------------------------------------------
// global.fetch mock for outbound HTTP (webhook/slack/discord/telegram alerts,
// email-provider `test` calls). Records every call and lets a test script the
// responses. Restore with the returned `restore()` in afterEach/finally.
// ---------------------------------------------------------------------------

export interface RecordedCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

export interface FetchMock {
	calls: RecordedCall[];
	spy: { mockRestore: () => void };
	restore: () => void;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type Responder = (
	url: string,
	init: FetchInit | undefined,
) => Response | Promise<Response>;

function headersToObject(init: FetchInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	const h = init?.headers;
	if (!h) return out;
	if (h instanceof Headers) {
		h.forEach((v, k) => {
			out[k] = v;
		});
	} else if (Array.isArray(h)) {
		for (const pair of h) out[String(pair[0])] = String(pair[1]);
	} else {
		for (const [k, v] of Object.entries(h)) out[k] = String(v);
	}
	return out;
}

function fetchUrl(input: FetchInput): string {
	return typeof Request !== "undefined" && input instanceof Request
		? input.url
		: String(input);
}

/**
 * Install a fetch mock. By default every call resolves 200 "ok". Pass a
 * `responder` to vary status/body (e.g. simulate a provider API error).
 */
export function mockFetch(responder?: Responder): FetchMock {
	const calls: RecordedCall[] = [];

	const spy = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async (input: FetchInput, init?: FetchInit) => {
				const url = fetchUrl(input);
				calls.push({
					url,
					method: (init?.method ?? "GET").toUpperCase(),
					headers: headersToObject(init),
					body: init?.body == null ? undefined : String(init.body),
				});
				if (responder) return responder(url, init);
				return new Response("ok", { status: 200 });
			},
		);

	return { calls, spy, restore: () => spy.mockRestore() };
}
