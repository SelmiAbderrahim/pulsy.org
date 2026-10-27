import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { formatDate } from "@/lib/date-format";
import { formatRelativeTime } from "@/lib/uptime/format";

type RelativeTimeProps = Omit<ComponentPropsWithoutRef<"time">, "children" | "dateTime" | "title"> & {
  value: string | number | Date | null;
  locale?: string;
  timezone?: string;
  /** Pass a collection's useElapsedClock value to share one timer across rows. */
  now?: number;
};

/** Live relative label and absolute title always derive from the same timestamp. */
export function RelativeTime({ value, locale, timezone, now, className, ...props }: RelativeTimeProps) {
  const { i18n } = useTranslation();
  const language = locale ?? i18n.resolvedLanguage ?? i18n.language ?? "en";
  const date = value === null ? null : new Date(value);
  const valid = date !== null && Number.isFinite(date.getTime());
  const clock = useElapsedClock(valid && now === undefined);
  const iso = valid ? date.toISOString() : undefined;
  const absolute = valid ? formatDate(date, language, timezone, { dateStyle: "full", timeStyle: "long" }) : undefined;
  const time = <time tabIndex={valid ? 0 : undefined} {...props} className={cn("rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring", className)} dateTime={iso} title={absolute}>
    {formatRelativeTime(iso ?? null, language, now ?? clock)}
  </time>;
  return valid ? <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>{time}</TooltipTrigger><TooltipContent>{absolute}</TooltipContent></Tooltip></TooltipProvider> : time;
}
