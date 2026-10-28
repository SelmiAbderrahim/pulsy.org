import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { HelpPage } from "./dashboard_.help.$topic";

export const Route = createFileRoute("/_app/dashboard_/help")({
  component: HelpLayout,
});

function HelpLayout() {
  const article = useMatch({ from: "/_app/dashboard_/help/$topic", shouldThrow: false });
  return article ? <Outlet /> : <HelpPage topic="index" />;
}
