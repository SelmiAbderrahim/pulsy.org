import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { MonitorActiveFilters } from "./monitor-active-filters";

vi.mock("react-i18next", () => reactI18nextMock());

describe("MonitorActiveFilters", () => {
  it("removes only the chosen tag and keeps focus on the next chip", async () => {
    const change = vi.fn();
    function Fixture() {
      const [tags, setTags] = useState(["release,one", "العربية"]);
      return <MonitorActiveFilters search="api" status="down" tags={tags} allTags onSearchChange={vi.fn()} onStatusClear={vi.fn()} onTagsChange={value => { change(value); setTags(value); }} onClear={vi.fn()} onEmpty={vi.fn()} />;
    }
    render(<Fixture />);
    await userEvent.click(screen.getByText("tags.label: release,one"));
    expect(change).toHaveBeenCalledWith(["العربية"]);
    expect(screen.getByText("tags.label: العربية").closest("button")).toHaveFocus();
    expect(screen.getByText("views.health: status.down")).toBeInTheDocument();
    expect(screen.getByText("views.activeSearch")).toBeInTheDocument();
  });

  it("restores focus outside the chips when the last filter is removed", async () => {
    const remove = vi.fn(), restore = vi.fn();
    render(<MonitorActiveFilters search="" tags={[]} status="down" allTags={false} onSearchChange={vi.fn()} onStatusClear={remove} onTagsChange={vi.fn()} onClear={vi.fn()} onEmpty={restore} />);
    await userEvent.click(screen.getByText("views.health: status.down"));
    expect(remove).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("clears all filters explicitly and restores focus", async () => {
    const clear = vi.fn(), restore = vi.fn();
    render(<MonitorActiveFilters search="api" tags={["prod"]} allTags={false} onSearchChange={vi.fn()} onStatusClear={vi.fn()} onTagsChange={vi.fn()} onClear={clear} onEmpty={restore} />);
    await userEvent.click(screen.getByRole("button", { name: "views.clear" }));
    expect(clear).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });
});
