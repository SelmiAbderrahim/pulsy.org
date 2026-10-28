import { expect, it } from "vitest";
import { carrySearch } from "./dashboard-search";
it("preserves valid notification tabs alongside filters and drops unknown tabs", () => {
  for (const notificationTab of ["providers", "defaults", "monitors"]) {
    expect(carrySearch({ panel: "notifications", notificationTab, q: "API" })).toEqual({ panel: "notifications", notificationTab, q: "API" });
  }
  expect(carrySearch({ panel: "notifications", notificationTab: "unsupported" })).toEqual({ panel: "notifications" });
});
