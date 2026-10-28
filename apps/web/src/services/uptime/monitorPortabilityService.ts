import { trpcMutation } from "@/lib/api/trpc";
export interface ConfigurationPreview {
  manifest: unknown;
  revision: string;
  warnings: Array<{ key: string; field: string }>;
  counts: { create: number; update: number; unchanged: number; rejected: number };
  entries: Array<{ key: string; action: "create" | "update" | "unchanged" | "rejected"; changes: Array<{ field: string; before: unknown; after: unknown }>; reasons: string[] }>;
}
export const MonitorPortabilityService = {
  export: (monitorIds: string[]) => trpcMutation<Pick<ConfigurationPreview, "manifest" | "warnings">>("uptimeMonitor", "portability.export", { monitorIds }),
  preview: (text: string) => trpcMutation<ConfigurationPreview>("uptimeMonitor", "portability.preview", { text }),
  apply: (text: string, revision: string) => trpcMutation<{ counts: ConfigurationPreview["counts"] }>("uptimeMonitor", "portability.reconcile", { text, revision }),
};
