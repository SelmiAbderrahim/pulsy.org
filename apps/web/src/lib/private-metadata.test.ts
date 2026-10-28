import path from "node:path";
import { describe, expect, it } from "vitest";
import { privateTitleResources } from "../../private-metadata";

describe("private shell metadata", () => {
  it("reads only OSS namespaces and exposes the same navigation and tabs in five locales", () => {
    const resources = privateTitleResources(path.resolve("."));
    expect(Object.keys(resources)).toEqual(["en", "ar", "fr", "de", "es"]);
    for (const resource of Object.values(resources)) {
      expect(Object.keys(resource).sort()).toEqual(["help", "monitorTabs", "nav", "statusTabs"]);
      expect(resource.nav.monitors).toBeTruthy();
      expect(resource.monitorTabs.overview).toBeTruthy();
    }
  });
});
