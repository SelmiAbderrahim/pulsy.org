import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";
type Outputs = inferRouterOutputs<AppRouter>["uptimeMonitor"]["statusPage"]["communication"];
type Inputs = inferRouterInputs<AppRouter>["uptimeMonitor"]["statusPage"]["communication"];
export type PageCommunication = Outputs["one"];
export type ComponentDraft = Inputs["componentsPreview"]["components"][number];
export type ComponentPreview = Outputs["componentsPreview"];
export type AnnouncementDraft = Inputs["draft"];
export type AnnouncementPreview = Outputs["preview"];
export type PublicAnnouncement = inferRouterOutputs<AppRouter>["uptimeMonitor"]["public"]["statusPageBySlug"]["announcements"][number];

export type SubscriptionReadiness = Outputs["subscriptions"];
export type SubscriptionConfiguration = Inputs["subscriptionsConfigure"];

export type PublicHistoryPreview = Outputs["historyPreview"];
