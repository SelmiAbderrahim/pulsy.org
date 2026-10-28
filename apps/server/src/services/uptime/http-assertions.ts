import { apiHttpAssertions, httpPathTokens } from "@pulsy/db/validation-http";

export const MAX_ASSERTION_RESPONSE_BYTES = 512 * 1024;

type OutcomeReason =
	| "pass"
	| "mismatch"
	| "missing"
	| "not_numeric"
	| "invalid_json"
	| "response_limit"
	| "unread_response";

export interface HttpAssertionOutcome {
	index: number;
	passed: boolean;
	reason: OutcomeReason;
}

type ParsedBody =
	| { value: unknown; reason?: never }
	| { reason: "invalid_json" | "response_limit"; value?: never };

function parseBody(text: string): ParsedBody {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { reason: "invalid_json" };
	}
	const pending = [{ value, depth: 0 }];
	let nodes = 0;
	while (pending.length) {
		const item = pending.pop()!;
		if (++nodes > 10000 || item.depth > 16) return { reason: "response_limit" };
		if (item.value !== null && typeof item.value === "object") {
			const children = Object.values(item.value);
			if (nodes + pending.length + children.length > 10000) {
				return { reason: "response_limit" };
			}
			for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
		}
	}
	return { value };
}

const missing = Symbol("missing JSON field");

function fieldAt(value: unknown, tokens: string[]): unknown {
	for (const token of tokens) {
		if (value === null || typeof value !== "object" || !Object.hasOwn(value, token)) return missing;
		if (Array.isArray(value) && !/^[0-9]+$/.test(token)) return missing;
		value = (value as Record<string, unknown>)[token];
	}
	return value;
}

function equals(actual: unknown, expected: unknown): boolean {
	if (Array.isArray(actual) && Array.isArray(expected)) {
		return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
	}
	return actual === expected;
}

/** Supplied bytes only: no I/O, executable expressions, or response values in outcomes. */
export function evaluateHttpAssertions(
	input: unknown,
	response: { text?: string; headers: Headers },
): HttpAssertionOutcome[] {
	const rules = apiHttpAssertions.parse(input);
	const oversized = response.text !== undefined && Buffer.byteLength(response.text, "utf8") > MAX_ASSERTION_RESPONSE_BYTES;
	const json = !oversized && response.text !== undefined && rules.some(rule => rule.type === "json")
		? parseBody(response.text)
		: undefined;
	return rules.map((rule, index) => {
		const outcome = (reason: OutcomeReason): HttpAssertionOutcome => ({ index, passed: reason === "pass", reason });
		if (rule.type === "header_equals" || rule.type === "header_contains") {
			const actual = response.headers.get(rule.name);
			if (actual === null) return outcome("missing");
			const passed = rule.type === "header_equals" ? actual === rule.value : actual.includes(rule.value);
			return outcome(passed ? "pass" : "mismatch");
		}
		if (response.text === undefined) return outcome("unread_response");
		if (oversized) return outcome("response_limit");
		if (rule.type === "body_contains" || rule.type === "body_not_contains") {
			return outcome(response.text.includes(rule.value) === (rule.type === "body_contains") ? "pass" : "mismatch");
		}
		if (json!.reason) return outcome(json!.reason);
		const actual = fieldAt(json!.value, httpPathTokens(rule.path)!);
		if (actual === missing) return outcome("missing");
		if (rule.op === "exists") return outcome("pass");
		if (rule.op === "equals" || rule.op === "not_equals") {
			return outcome(equals(actual, rule.value) === (rule.op === "equals") ? "pass" : "mismatch");
		}
		if (typeof actual !== "number" || !Number.isFinite(actual)) return outcome("not_numeric");
		// Numeric operator values were validated by apiHttpAssertions.
		const expected = rule.value as number;
		const passed = rule.op === "lt" ? actual < expected
			: rule.op === "lte" ? actual <= expected
				: rule.op === "gt" ? actual > expected
					: actual >= expected;
		return outcome(passed ? "pass" : "mismatch");
	});
}
