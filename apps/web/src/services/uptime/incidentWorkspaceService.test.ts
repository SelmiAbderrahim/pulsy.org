import { beforeEach, describe, expect, it, vi } from "vitest";
import { trpcQuery } from "@/lib/api/trpc";
import { IncidentWorkspaceService } from "./incidentWorkspaceService";

vi.mock("@/lib/api/trpc", () => ({ trpcQuery: vi.fn(), trpcMutation: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("incident URL filter boundary", () => {
	it("strips inherited language and panel navigation from the strict list input", async () => {
		const inheritedSearch = {
			state: "all" as const, search: "Backup", monitorId: "monitor-1",
			severity: "critical" as const, groupId: "group-1", lng: "ar",
			incidentId: "selected", cursorAt: "2026-10-09T12:00:00.000Z", cursorId: "previous",
		};
		await IncidentWorkspaceService.list(inheritedSearch);
		expect(trpcQuery).toHaveBeenCalledWith("uptimeMonitor", "incidentWorkspace.list", {
			state: "all", search: "Backup", monitorId: "monitor-1", severity: "critical", groupId: "group-1",
			limit: 25, cursor: undefined,
		});
	});

	it("uses only the explicit pagination cursor while preserving list filters", async () => {
		const cursor = { startedAt: "2026-10-09T12:00:00.000Z", incidentId: "previous" };
		await IncidentWorkspaceService.list({ state: "all", search: "Backup" }, cursor);
		expect(trpcQuery).toHaveBeenCalledWith("uptimeMonitor", "incidentWorkspace.list", {
			state: "all", search: "Backup", monitorId: undefined, severity: undefined, groupId: undefined,
			limit: 25, cursor,
		});
	});
});
