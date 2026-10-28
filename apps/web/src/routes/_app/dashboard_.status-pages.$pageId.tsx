import { createFileRoute } from "@tanstack/react-router";
import { StatusCommunicationEditor, statusEditorTabs, type StatusEditorTab } from "@/components/uptime/status-communication-editor";
export const Route = createFileRoute("/_app/dashboard_/status-pages/$pageId")({
  validateSearch: (search: Record<string, unknown>): { tab: StatusEditorTab } => ({ tab: statusEditorTabs.includes(search.tab as StatusEditorTab) ? search.tab as StatusEditorTab : "general" }),
  component: StatusPageCommunication,
});
function StatusPageCommunication() {
  const { pageId } = Route.useParams(), { tab } = Route.useSearch(), navigate = Route.useNavigate();
  return <section className="app-page"><StatusCommunicationEditor key={pageId} pageId={pageId} tab={tab} onTabChange={value => void navigate({ search: { tab: value } })} /></section>;
}
