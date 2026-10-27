import { describe, expect, it } from "vitest";
import { safeAuthReturn } from "./auth-return";
describe("session return destinations", () => {
  it("preserves monitor tabs and collection filters", () => {
    for (const path of ["/dashboard?group=tag&search=api", "/dashboard/uptime/m1?tab=history", "/dashboard/status-pages/p1#draft", "/superadmin?section=overview"]) expect(safeAuthReturn(path)).toBe(path);
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/dashboard/../../login", "/dashboardevil", "/login", "javascript:alert(1)", " /dashboard", "/dashboard\n", null, 123])("rejects external or unrelated destinations: %s", value => {
    expect(safeAuthReturn(value)).toBeUndefined();
  });
});
