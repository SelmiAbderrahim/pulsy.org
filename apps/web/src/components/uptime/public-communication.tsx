import { formattingLocale } from "@/lib/formatting-locale";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import type { PublicStatusPage } from "@/types/uptime";

function publicTime(value: string, timezone: string, language: string) {
  try { return new Intl.DateTimeFormat(formattingLocale(language), { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)); }
  catch { return value; }
}

/** Published plain text only; manual communication never changes measured health. */
export function PublicCommunication({ data }: { data: PublicStatusPage }) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  if (!data.publicKey && !data.announcements?.length) return null;
  const updates = data.announcements ?? [];
  const names = new Map(data.monitors.filter(monitor => monitor.componentId).map(monitor => [monitor.componentId, monitor.name]));
  return <SectionCard title={t("communication.publicUpdates", "Published updates")} description={t("communication.publicPrivacy", "Published updates describe the response. Component health continues to show measured results.")}><div className="space-y-4">
      {!updates.length && <p className="text-sm text-muted-foreground">{t("communication.noPublicUpdates", "No published updates yet.")}</p>}
      {updates.map(update => <article key={update.id} id={`announcement-${update.id}`} className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-medium" dir="auto"><bdi>{update.title}</bdi></h3>
          <Badge variant="outline" className="whitespace-normal">{t(`communication.stages.${update.stage}`, { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" }[update.stage])}</Badge>
        </div>
        {update.publishedAt && <p className="text-xs text-muted-foreground"><time dateTime={update.publishedAt}>{publicTime(update.publishedAt, update.timezone, i18n.language)}</time> · <bdi>{update.timezone}</bdi></p>}
        {update.kind === "maintenance" && update.startsAt && update.endsAt && <p className="text-sm">
          <span className="font-medium">{t("communication.scheduled", "Scheduled maintenance")}: </span>
          <time dateTime={update.startsAt}>{publicTime(update.startsAt, update.timezone, i18n.language)}</time> – <time dateTime={update.endsAt}>{publicTime(update.endsAt, update.timezone, i18n.language)}</time> · <bdi>{update.timezone}</bdi>
        </p>}
        <p className="whitespace-pre-wrap break-words text-sm" dir="auto">{update.text}</p>
        <p className="text-xs text-muted-foreground">{t("communication.affected", "Affected components")}: {update.componentIds.flatMap(id => names.has(id) ? [<bdi key={id} className="me-2">{names.get(id)}</bdi>] : [])}</p>
      </article>)}
    </div></SectionCard>;
}
