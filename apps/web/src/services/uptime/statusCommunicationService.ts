import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { AnnouncementDraft, AnnouncementPreview, ComponentDraft, ComponentPreview, PageCommunication, SubscriptionReadiness, SubscriptionConfiguration, PublicHistoryPreview } from "@/types/status-communication";
export const StatusCommunicationService = {
  historyPreview: (statusPageId: string, enabled: boolean) => trpcQuery<PublicHistoryPreview>("uptimeMonitor", "statusPage.communication.historyPreview", { statusPageId, enabled }),
  historyApply: (statusPageId: string, enabled: boolean, revision: string) => trpcMutation<{ enabled: boolean; published: boolean }>("uptimeMonitor", "statusPage.communication.historyApply", { statusPageId, enabled, revision }),
  subscriptions: (statusPageId: string) => trpcQuery<SubscriptionReadiness>("uptimeMonitor", "statusPage.communication.subscriptions", { statusPageId }),
  subscriptionsConfigure: (input: SubscriptionConfiguration) => trpcMutation<SubscriptionReadiness>("uptimeMonitor", "statusPage.communication.subscriptionsConfigure", input),
  one: (statusPageId: string) => trpcQuery<PageCommunication>("uptimeMonitor", "statusPage.communication.one", { statusPageId }),
  componentsPreview: (statusPageId: string, components: ComponentDraft[]) => trpcMutation<ComponentPreview>("uptimeMonitor", "statusPage.communication.componentsPreviewPost", { statusPageId, components }),
  componentsApply: (statusPageId: string, components: ComponentDraft[], revision: string) => trpcMutation<{ saved: boolean }>("uptimeMonitor", "statusPage.communication.componentsApply", { statusPageId, components, revision }),
  draft: (input: AnnouncementDraft) => trpcMutation<{ id: string }>("uptimeMonitor", "statusPage.communication.draft", input),
  deleteDraft: (id: string) => trpcMutation<{ deleted: boolean }>("uptimeMonitor", "statusPage.communication.deleteDraft", { id }),
  preview: (id: string) => trpcQuery<AnnouncementPreview>("uptimeMonitor", "statusPage.communication.preview", { id }),
  publish: (id: string, revision: string) => trpcMutation<{ published: boolean }>("uptimeMonitor", "statusPage.communication.publish", { id, revision }),
};
