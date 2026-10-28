import { db, uptimeMonitorView } from "@pulsy/db";
import { describe, expect, it } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
const filters = { search: "agency", tags: ["Production", "client,one"], tagMode: "all" as const, health: "down" as const, sort: "name" as const, direction: "desc" as const, density: "compact" as const, group: "environment" as const };
describe("personal persisted monitor views", () => {
  it("round-trips explicit filters without creating monitors and isolates accounts", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const view = await caller.uptimeMonitor.view.save({ name: "Agency production", filters, pinned: true, isDefault: true });
    expect(view).toMatchObject({ name: "Agency production", filters, pinned: true, isDefault: true });
    expect(await caller.uptimeMonitor.view.list()).toHaveLength(1);
    expect(await caller.uptimeMonitor.monitor.list()).toHaveLength(0);
    expect(await authedCaller(other).uptimeMonitor.view.list()).toHaveLength(0);
    await expect(authedCaller(other).uptimeMonitor.view.save({ id: view.id, name: "Foreign", filters })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authedCaller(other).uptimeMonitor.view.remove({ id: view.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(publicCaller().uptimeMonitor.view.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("serializes simultaneous default changes, retains updates, and removes only owned views", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const views = await Promise.all(Array.from({ length: 8 }, (_, index) => caller.uptimeMonitor.view.save({ name: `View ${index}`, filters, isDefault: true })));
    const stored = await caller.uptimeMonitor.view.list(); expect(stored).toHaveLength(8); expect(stored.filter(view => view.isDefault)).toHaveLength(1);
    const changed = await caller.uptimeMonitor.view.save({ id: views[0]!.id, name: "Changed", filters: { ...filters, tagMode: "any", health: "pending" }, pinned: true });
    expect(changed).toMatchObject({ name: "Changed", pinned: true, filters: { tagMode: "any", health: "pending" } });
    await caller.uptimeMonitor.view.remove({ id: changed.id }); expect(await caller.uptimeMonitor.view.list()).toHaveLength(7);
  });
  it("enforces the safety bound under simultaneous creation without affecting monitors", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    await db.insert(uptimeMonitorView).values(Array.from({ length: 199 }, (_, index) => ({ userId: owner.id, name: `Existing ${index}`, filters })));
    const results = await Promise.allSettled([caller.uptimeMonitor.view.save({ name: "Final one", filters }), caller.uptimeMonitor.view.save({ name: "Over capacity", filters })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await caller.uptimeMonitor.view.list()).toHaveLength(200);
    expect(await caller.uptimeMonitor.monitor.list()).toHaveLength(0);
  });
  it.each(["en", "ar", "fr", "de", "es"] as const)("localizes rejected configuration in %s", async language => {
    const caller = authedCaller({ ...await createTestUser(), language });
    await expect(caller.uptimeMonitor.view.save({ name: " ", filters })).rejects.toMatchObject({ code: "BAD_REQUEST", message: getTranslator(language)("errors.monitorViewInvalid") });
  });
  it("rejects oversized or unrecognized filters at the protected boundary", async () => {
    const caller = authedCaller(await createTestUser());
    await expect(caller.uptimeMonitor.view.save({ name: " ", filters })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.uptimeMonitor.view.save({ name: "Invalid", filters: { ...filters, search: "x".repeat(101) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.uptimeMonitor.view.save({ name: "Invalid", filters: { ...filters, tags: Array.from({ length: 51 }, (_, i) => `${i}`) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const input: unknown = { name: "Unsafe", filters, unexpectedField: "foreign" };
    await expect(caller.uptimeMonitor.view.save(input as Parameters<typeof caller.uptimeMonitor.view.save>[0])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.uptimeMonitor.view.list()).toHaveLength(0);
  });
});
