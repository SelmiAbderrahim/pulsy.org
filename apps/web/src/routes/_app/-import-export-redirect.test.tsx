import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, defaultParseSearch, Outlet, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./dashboard_.configuration";
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-router")>(),
  createFileRoute: () => (options: object) => ({options}),
}));
beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
describe("legacy import/export links", () => {
  it.each(["", "?lng=ar&tab=review&tag=one&tag=two&empty=&encoded=a%2Fb%26c&flag=false", "?returnTo=%2Fdashboard%3Fpanel%3Dtemplates&custom=%D8%B9%D8%B1%D8%A8%D9%8A"])("forwards every search value to a replace redirect %s", searchStr => {
    let caught: unknown;
    try { Route.options.beforeLoad!({location:{searchStr,hash:"review"}} as never); } catch(error) { caught=error; }
    expect(caught).toMatchObject({options:{href:`/dashboard/import-export${searchStr}#review`,replace:true}});
  });
});


it("preserves every query value through actual navigation and replaces the legacy history entry", async () => {
  const root=createRootRoute({component:Outlet});
  const home=createRoute({getParentRoute:()=>root,path:"/dashboard",component:()=> <p>Dashboard</p>});
  const legacy=createRoute({getParentRoute:()=>root,path:"/dashboard/configuration",beforeLoad:args=>Route.options.beforeLoad!(args as never)});
  const destination=createRoute({getParentRoute:()=>root,path:"/dashboard/import-export",component:()=> <p>Import & export</p>});
  const query="?lng=ar&tag=one&tag=two&empty=&encoded=a%2Fb%26c&flag=false";
  const history=createMemoryHistory({initialEntries:["/dashboard",`/dashboard/configuration${query}#review`]});
  const router=createRouter({routeTree:root.addChildren([home,legacy,destination]),history});
  render(<RouterProvider router={router} />);
  await screen.findByText("Import & export");
  expect(history.location.pathname).toBe("/dashboard/import-export");
  expect(router.state.location.search).toEqual(defaultParseSearch(query));
  expect(router.state.location.hash).toBe("review");
  act(()=>history.back());
  await waitFor(()=>expect(screen.getByText("Dashboard")).toBeInTheDocument());
  expect(history.location.pathname).toBe("/dashboard");
});
