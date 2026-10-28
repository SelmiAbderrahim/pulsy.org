import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/dashboard_/configuration")({
  beforeLoad: ({ location }) => {
    // Pass every query value; the router may normalize its URL serialization.
    throw redirect({ href: `/dashboard/import-export${location.searchStr}${location.hash ? `#${location.hash}` : ""}`, replace: true });
  },
});
