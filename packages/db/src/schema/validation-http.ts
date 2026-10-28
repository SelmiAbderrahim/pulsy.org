import { z } from "zod";

/** Bounded dotted ASCII keys and indexed arrays; executable paths are forbidden. */
export function httpPathTokens(path: string): string[] | null {
  if (!path.startsWith("$") || path.length > 256) return null;
  const tokens: string[] = []; let cursor = 1;
  for (const match of path.matchAll(/\.[A-Za-z_][A-Za-z0-9_]*|\[(?:0|[1-9][0-9]{0,4})\]/g)) {
    if (match.index !== cursor) return null;
    const token = match[0].startsWith(".") ? match[0].slice(1) : match[0].slice(1, -1);
    if (["__proto__", "constructor", "prototype"].includes(token)) return null;
    tokens.push(token); cursor += match[0].length;
  }
  return cursor === path.length ? tokens : null;
}

const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const value = z.union([scalar, z.array(scalar).max(50)]);
const headerName = z.string().min(1).max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
export const apiHttpAssertion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("body_contains"), value: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal("body_not_contains"), value: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal("header_equals"), name: headerName, value: z.string().max(1000) }).strict(),
  z.object({ type: z.literal("header_contains"), name: headerName, value: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal("json"), path: z.string().refine(path => httpPathTokens(path) !== null, "errors.httpAssertionPath"), op: z.enum(["exists", "equals", "not_equals", "lt", "lte", "gt", "gte"]), value: value.optional() }).strict(),
]).refine(rule => rule.type !== "json" || rule.op === "exists" || rule.value !== undefined, "errors.httpAssertionValue")
  .refine(rule => rule.type !== "json" || !["lt", "lte", "gt", "gte"].includes(rule.op) || typeof rule.value === "number", "errors.httpAssertionNumeric");
export const apiHttpAssertions = z.array(apiHttpAssertion).max(20);
export type HttpAssertion = z.infer<typeof apiHttpAssertion>;

const headerValue = z.string().max(4096).refine(value => !/[\r\n\0]/.test(value), "errors.httpHeaderValue");
const forbiddenHeaders = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "te", "trailer"]);
function validJsonBody(body: string): boolean {
  try {
    const pending = [{ value: JSON.parse(body) as unknown, depth: 0 }]; let nodes = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++nodes > 10000 || item.depth > 16) return false;
      if (item.value !== null && typeof item.value === "object") {
        const children = Object.values(item.value);
        if (nodes + pending.length + children.length > 10000) return false;
        for (const value of children) pending.push({ value, depth: item.depth + 1 });
      }
    }
    return true;
  } catch { return false; }
}
export const apiHttpRequest = z.object({
  headers: z.array(z.object({ name: headerName.refine(name => !forbiddenHeaders.has(name.toLowerCase()), "errors.httpHeaderName"), value: headerValue }).strict()).max(20).default([]),
  body: z.string().max(65536).optional(),
  contentType: headerValue.refine(value => value.length <= 128, "errors.httpHeaderValue").optional(),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("basic"), username: headerValue.refine(value => !value.includes(":"), "errors.httpHeaderValue"), password: headerValue }).strict(),
    z.object({ type: z.literal("bearer"), token: headerValue.refine(value => value.length > 0, "errors.httpHeaderValue") }).strict(),
  ]).optional(),
}).strict().refine(request => {
  const names = request.headers.map(header => header.name.toLowerCase());
  return new Set(names).size === names.length && !(request.auth && names.includes("authorization"));
}, "errors.httpHeaderName").refine(request => new TextEncoder().encode(JSON.stringify(request.headers)).byteLength <= 16384, "errors.httpRequestLimit").refine(request => new TextEncoder().encode(JSON.stringify(request)).byteLength <= 81920 && new TextEncoder().encode(request.body ?? "").byteLength <= 65536, "errors.httpRequestLimit").refine(request => {
  const contentType = request.contentType ?? request.headers.find(header => header.name.toLowerCase() === "content-type")?.value;
  return request.body === undefined || !(contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json" || contentType?.split(";", 1)[0]?.trim().toLowerCase().endsWith("+json")) || validJsonBody(request.body);
}, "errors.httpBodyJSON");
export type HttpRequest = z.infer<typeof apiHttpRequest>;
