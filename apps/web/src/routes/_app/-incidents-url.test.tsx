import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const captured = vi.hoisted(() => ({ options: undefined as undefined | { validateSearch: (value: Record<string, unknown>) => Record<string, unknown>; component: () => ReactElement } }));
let workspaceProps: { onFilters: (value: Record<string, unknown>) => void; onSelect: (id?: string) => void; filters: Record<string, unknown> };
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: NonNullable<typeof captured.options>) => { captured.options = options; return { useSearch: () => search.value, options }; },
	useNavigate: () => navigate,
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/uptime/incident-workspace", () => ({ IncidentWorkspace: (props: typeof workspaceProps) => { workspaceProps = props; return null; } }));

await import("./dashboard_.incidents");
const validate = (value: Record<string, unknown>) => captured.options!.validateSearch(value);
beforeEach(() => navigate.mockClear());

describe("incidents URL keeps defaults implicit", () => {
	it("normalises missing, invalid and oversized values to the defaults", () => {
		expect(validate({})).toMatchObject({ state: "open", search: "" });
		expect(validate({ state: "bogus", severity: "x", cursorAt: "nope", cursorId: "c1" })).toMatchObject({ state: "open", severity: undefined, cursorAt: undefined, cursorId: undefined });
		expect((validate({ search: "x".repeat(300) }).search as string).length).toBe(100);
		expect(validate({ state: "resolved" }).state).toBe("resolved");
	});
	it("omits state=open and an empty search when the filters change", () => {
		search.value = validate({});
		const Page = captured.options!.component; render(<Page />);
		workspaceProps.onFilters({ state: "open", search: "   " });
		expect(navigate).toHaveBeenLastCalledWith({ to: "/dashboard/incidents", search: { state: undefined, search: undefined } });
		workspaceProps.onFilters({ state: "resolved", search: "api" });
		expect(navigate).toHaveBeenLastCalledWith({ to: "/dashboard/incidents", search: { state: "resolved", search: "api" } });
	});
	it("keeps defaults out of the URL when an incident is selected", () => {
		search.value = validate({});
		const Page = captured.options!.component; render(<Page />);
		workspaceProps.onSelect("inc-1");
		const call = navigate.mock.calls.at(-1)![0] as { search: Record<string, unknown> };
		expect(call.search).toMatchObject({ state: undefined, search: undefined, incidentId: "inc-1" });
	});
});
