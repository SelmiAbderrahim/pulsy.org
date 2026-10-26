import { describe, expect, it } from "vitest";
import { apiServerConfiguration } from "./validation-server";

describe("server filesystem exclusions at the API schema boundary", () => {
  it("accepts separate absolute Linux paths, including root, spaces and Unicode", () => {
    const excludedFilesystems = ["/", "/var/lib/postgresql", "/mnt/Backup Disk", "/mnt/نسخ"];
    expect(apiServerConfiguration.parse({ name: "Host", excludedFilesystems }).excludedFilesystems)
      .toEqual(excludedFilesystems);
  });

  it.each([
    ["empty", ""],
    ["relative", "var/lib/postgresql"],
    ["dot-relative", "./var/lib/postgresql"],
    ["home-relative", "~/backups"],
    ["Windows drive", "C:\\backups"],
    ["multiple newline-separated paths", "/var/lib\n/mnt/backups"],
    ["multiple CRLF-separated paths", "/var/lib\r\n/mnt/backups"],
    ["NUL", "/mnt/back\u0000ups"],
    ["tab", "/mnt/back\tups"],
    ["DEL", "/mnt/back\u007fups"],
  ])("rejects %s without accepting the rest of a configuration", (_label, invalidPath) => {
    const result = apiServerConfiguration.safeParse({
      name: "Host", excludedFilesystems: ["/valid", invalidPath],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Invalid filesystem exclusion was accepted");
    expect(result.error.issues.some(issue => issue.path.join(".") === "excludedFilesystems.1"))
      .toBe(true);
  });
});
