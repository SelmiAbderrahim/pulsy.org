import { describe, expect, it } from "vitest";
import { apiExpectedStatuses, expectedStatusFields, matchesExpectedStatus, parseExpectedStatuses } from "./http-status-rule";
describe("HTTP status rules", () => {
  it("accepts codes, classes, Unicode ranges and bounded mixed lists", () => {
    expect(parseExpectedStatuses("204,200,204")).toEqual([200,204]);
    expect(parseExpectedStatuses("2xx")).toHaveLength(100);
    expect(parseExpectedStatuses("200–299")).toEqual(parseExpectedStatuses("2xx"));
    expect(parseExpectedStatuses("200, 301—302")).toEqual([200,301,302]);
    expect(apiExpectedStatuses.parse(" 2XX , 400–404 ")).toBe("2xx,400-404");
    expect(expectedStatusFields("204")).toEqual({expectedStatus:204,expectedStatuses:null});
    expect(matchesExpectedStatus(204,{expectedStatus:200,expectedStatuses:"200,204"})).toBe(true);
    expect(matchesExpectedStatus(204,{expectedStatus:200})).toBe(false);
  });
  it.each(["", "200,", "99", "600", "6xx", "200-199", "200-999", "2xx;alert(1)", "200.5", "*", "200 ".repeat(40)])("rejects malformed rule %s", value => {
    expect(parseExpectedStatuses(value)).toBeNull(); expect(apiExpectedStatuses.safeParse(value).success).toBe(false);
  });
});
