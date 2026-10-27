import type { TableHTMLAttributes } from "react";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { cn } from "@/lib/utils";

/** Each reference table owns its overflow; shadows follow the logical scroll edges. */
export function ApiDocsTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="group/api-table relative min-w-0 max-w-full rounded-md border">
    <ScrollableTable aria-label={props["aria-label"]} containerClassName="overflow-x-auto">
      <table {...props} className={cn("w-full min-w-[32rem] caption-bottom text-sm", className)} />
    </ScrollableTable>
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-0 z-10 w-2 opacity-0 shadow-[inset_6px_0_6px_-6px_hsl(var(--foreground)/0.35)] rtl:shadow-[inset_-6px_0_6px_-6px_hsl(var(--foreground)/0.35)] group-has-[[data-scroll-start=true]]/api-table:opacity-100" />
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 z-10 w-2 opacity-0 shadow-[inset_-6px_0_6px_-6px_hsl(var(--foreground)/0.35)] rtl:shadow-[inset_6px_0_6px_-6px_hsl(var(--foreground)/0.35)] group-has-[[data-scroll-end=true]]/api-table:opacity-100" />
  </div>;
}
