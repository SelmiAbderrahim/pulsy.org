import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./sheet";
export function ResponsiveFilters({ open, onOpenChange, children, id }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; id?: string }) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const { t } = useTranslation("common");
  if (mobile) return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="flex flex-col overflow-hidden"><SheetHeader><SheetTitle>{t("nav.filters")}</SheetTitle><SheetDescription className="sr-only">{t("formValidation.filterDescription")}</SheetDescription></SheetHeader><div id={id} className="grid min-h-0 gap-4 overflow-y-auto pt-4">{children}</div></SheetContent></Sheet>;
  return open ? <div id={id} className="grid gap-4 rounded-lg border bg-card p-4">{children}</div> : null;
}
