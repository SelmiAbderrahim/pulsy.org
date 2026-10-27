import { describe, expect, it } from "vitest";
import { isMissingResource } from "./is-missing-resource";
describe("resource absence versus recoverable failure", () => {
  it("accepts an authoritative missing status without guessing from server text", () => {
    expect(isMissingResource({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(isMissingResource({ data: { httpStatus: 404 } })).toBe(true);
    for (const error of [null, new Error("Not found"), { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } }, { data: { code: "FORBIDDEN", httpStatus: 403 } }, { data: null }]) expect(isMissingResource(error)).toBe(false);
  });
});
