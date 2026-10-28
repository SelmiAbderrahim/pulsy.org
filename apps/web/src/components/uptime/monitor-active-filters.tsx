import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface Props {
  search: string;
  status?: string;
  tags: string[];
  allTags: boolean;
  onSearchChange: (value: string) => void;
  onStatusClear: () => void;
  onTagsChange: (tags: string[]) => void;
  onClear: () => void;
  onEmpty: () => void;
}

/** Individual removals preserve the other filters and the selected view's draft. */
export function MonitorActiveFilters({ search, status, tags, allTags, onSearchChange, onStatusClear, onTagsChange, onClear, onEmpty }: Props) {
  const { t } = useTranslation("uptimeMonitor");
  const filters = [
    ...(search ? [{ key: "search", label: t("views.activeSearch", { query: search }), remove: () => onSearchChange("") }] : []),
    ...(status ? [{ key: "health", label: `${t("views.health")}: ${t(`status.${status}`)}`, remove: onStatusClear }] : []),
    ...tags.map(tag => ({ key: `tag:${tag}`, label: `${t("tags.label")}: ${tag}`, remove: () => onTagsChange(tags.filter(value => value !== tag)) })),
  ];
  if (!filters.length) return null;
  return (
    <div role="group" aria-label={t("views.activeFilters")} className="flex min-w-0 flex-wrap items-center gap-2">
      {filters.map(filter => (
        <Button key={filter.key} variant="secondary" className="h-auto min-h-11 max-w-full whitespace-normal text-start" aria-label={t("views.removeFilter", { filter: filter.label })} onClick={event => {
          // Removing a focused chip must not send keyboard focus to the document.
          const next = event.currentTarget.nextElementSibling;
          if (filters.length === 1) onEmpty();
          else if (next instanceof HTMLButtonElement) next.focus();
          filter.remove();
        }}>
          <bdi className="min-w-0 [overflow-wrap:anywhere]">{filter.label}</bdi><X aria-hidden="true" className="shrink-0" />
        </Button>
      ))}
      <Button variant="ghost" onClick={() => { onEmpty(); onClear(); }}>{t("views.clear")}</Button>
      {tags.length > 1 && <span className="text-sm text-muted-foreground">{t(allTags ? "views.all" : "views.any")}</span>}
    </div>
  );
}
