import { describe, expect, it } from "vitest";

import { evaluateHttpAssertions } from "../http-assertions";

describe("bounded HTTP assertions", () => {
  it("requires every rule against the same supplied response without exposing values", () => {
    const outcomes = evaluateHttpAssertions([
      { type: "body_contains", value: "error" },
      { type: "header_equals", name: "X-Ready", value: "yes" },
      { type: "json", path: "$.status", op: "equals", value: "ok" },
    ], { text: '{"status":"error","private":"fixture-secret"}', headers: new Headers({ "x-ready": "yes" }) });
    expect(outcomes.map(value => value.passed)).toEqual([true, true, false]);
    expect(JSON.stringify(outcomes)).not.toContain("fixture-secret");
  });

  it("distinguishes missing, null, false, zero, empty string and empty array", () => {
    const response = { text: '{"nil":null,"flag":false,"count":0,"empty":"","list":[]}', headers: new Headers() };
    const outcomes = evaluateHttpAssertions([
      { type: "json", path: "$.missing", op: "not_equals", value: 0 },
      ...([ ["nil", null], ["flag", false], ["count", 0], ["empty", ""], ["list", []] ] as const).map(([key, value]) => ({ type: "json" as const, path: `$.${key}`, op: "equals" as const, value: Array.isArray(value) ? [] : value })),
      { type: "json", path: "$.count", op: "exists" },
    ], response);
    expect(outcomes.map(value => value.passed)).toEqual([false, true, true, true, true, true, true]);
    expect(outcomes[0]?.reason).toBe("missing");
  });

  it("fails enabled JSON assertions specifically when JSON is invalid", () => {
    const outcomes = evaluateHttpAssertions([{ type: "json", path: "$.status", op: "exists" }], { text: "not JSON", headers: new Headers() });
    expect(outcomes[0]).toMatchObject({ passed: false, reason: "invalid_json" });
  });

  it("supports bounded indexed paths and numeric comparisons without coercion", () => {
    const outcomes = evaluateHttpAssertions([
      { type: "json", path: "$.jobs[0].depth", op: "lt", value: 100 },
      { type: "json", path: "$.jobs[1].depth", op: "lt", value: 100 },
      { type: "json", path: "$.jobs[0].depth", op: "gte", value: 99 },
    ], { text: '{"jobs":[{"depth":99},{"depth":"99"}]}', headers: new Headers() });
    expect(outcomes.map(value => value.passed)).toEqual([true, false, true]);
    expect(outcomes[1]?.reason).toBe("not_numeric");
  });

  it("rejects prototype segments, expression syntax and excessive rule counts at the boundary", () => {
    for (const path of ["$.__proto__.x", "$.constructor", "$.a[*]", "$.a()", "$..x"]) {
      expect(() => evaluateHttpAssertions([{ type: "json", path, op: "exists" }], { text: "{}", headers: new Headers() })).toThrow();
    }
    expect(() => evaluateHttpAssertions(Array.from({ length: 21 }, () => ({ type: "body_contains" as const, value: "x" })), { text: "x", headers: new Headers() })).toThrow();
  });

  it("bounds response bytes, parse depth and parsed nodes without storing bodies", () => {
    for (const text of ['"'+"x".repeat(524288)+'"', "[".repeat(18)+"0"+"]".repeat(18), JSON.stringify(Array.from({ length: 10001 }, () => 0))]) {
      const outcomes = evaluateHttpAssertions([{ type: "json", path: "$", op: "exists" }], { text, headers: new Headers() });
      expect(outcomes[0]).toMatchObject({ passed: false, reason: "response_limit" });
    }
  });

  it("does not confuse unread bodies or missing headers with an assertion mismatch", () => {
    const outcomes = evaluateHttpAssertions([
      { type: "body_not_contains", value: "bad" }, { type: "header_contains", name: "X-Ready", value: "yes" },
    ], { headers: new Headers() });
    expect(outcomes.map(value => value.reason)).toEqual(["unread_response", "missing"]);
  });
});
