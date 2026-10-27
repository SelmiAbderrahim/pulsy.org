import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { uptimeKeys } from "./queryKeys";
import { invalidateMonitorData, monitorRefetchInterval } from "./live-refresh";

it.each([[5,15000],[15,15000],[30,30000],[300,60000],[3600,60000]])("clamps a %s-second check interval to %s ms", (seconds, expected) => {
  expect(monitorRefetchInterval(seconds)).toBe(expected);
});
it("invalidates detail, all stats windows and log pages only for the selected monitor", async () => {
  const client = new QueryClient();
  const affected = [uptimeKeys.monitors.detail("a"), uptimeKeys.checkLogs.stats("a",7), uptimeKeys.checkLogs.stats("a",30), uptimeKeys.checkLogs.list("a",{limit:20,offset:20})];
  const other = uptimeKeys.checkLogs.stats("b",30);
  for (const key of [...affected, other]) client.setQueryData(key, { value: 1 });
  await invalidateMonitorData(client,"a");
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});
