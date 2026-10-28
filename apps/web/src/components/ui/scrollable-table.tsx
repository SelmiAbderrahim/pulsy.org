import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface ScrollableTableProps extends React.HTMLAttributes<HTMLDivElement> {
  pageScroll?: boolean;
  containerClassName?: string;
}
/** Owns horizontal overflow and logical sticky edges, while retaining a natural page height. */
export const ScrollableTable = React.forwardRef<HTMLDivElement, ScrollableTableProps>(
  ({ className, containerClassName, pageScroll = false, children, onScroll, ...props }, forwardedRef) => {
  const { t } = useTranslation("common");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = React.useState({ overflowing: false, start: false, end: false });
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const measure = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const maximum = container.scrollWidth - container.clientWidth;
    const offset = Math.min(maximum, Math.abs(container.scrollLeft));
    const next = { overflowing: maximum > 0, start: maximum > 0 && offset > 1, end: maximum > 0 && offset < maximum - 1 };
    setEdges(previous => previous.overflowing === next.overflowing && previous.start === next.start && previous.end === next.end ? previous : next);
  }, []);
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(container);
    const observeTable = () => { const table = container.querySelector("table"); if (table) observer?.observe(table); measure(); };
    observeTable();
    const mutations = new MutationObserver(observeTable);
    mutations.observe(container, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); mutations.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);
  React.useEffect(() => {
    if (!pageScroll) return;
    const container = containerRef.current;
    const table = container?.querySelector("table");
    const header = table?.tHead;
    if (!container || !table || !header) return;
    let frame: number | undefined;
    // overflow-x:auto establishes a scroll container even without a height cap,
    // so CSS sticky cannot follow the page. Translate the real header instead;
    // columns, sorting, selection and horizontal scrolling stay in one table.
    const update = () => {
      frame = undefined;
      const bounds = table.getBoundingClientRect();
      const offset = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
      const limit = Math.max(0, bounds.height - header.offsetHeight);
      const y = Math.min(limit, Math.max(0, offset - bounds.top));
      header.style.transform = `translateY(${y}px)`;
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(table);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      header.style.removeProperty("transform");
    };
  }, [pageScroll]);
  return <div className={cn("relative min-w-0 max-w-full", className)}>
    {edges.overflowing && <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("nav.scrollTable")}</p>}
    <div {...props} ref={setRefs} role="region" aria-label={props["aria-label"] ?? t("nav.dataTable")} tabIndex={props.tabIndex ?? 0}
      data-scroll-start={edges.start || undefined} data-scroll-end={edges.end || undefined}
      onScroll={event => { measure(); onScroll?.(event); }}
      className={cn("relative w-full overflow-auto data-[scroll-start=true]:[&_[data-sticky=start]]:border-e data-[scroll-start=true]:[&_[data-sticky=start]]:border-border data-[scroll-end=true]:[&_[data-sticky=end]]:border-s data-[scroll-end=true]:[&_[data-sticky=end]]:border-border", containerClassName)}>{children}</div>
  </div>;
});
ScrollableTable.displayName = "ScrollableTable";
