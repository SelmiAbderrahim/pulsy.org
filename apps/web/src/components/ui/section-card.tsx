import * as React from "react";
import { cn } from "@/lib/utils";
export interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  headerEnd?: React.ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  headingId?: string;
}
export const SectionCard = React.forwardRef<HTMLElement, SectionCardProps>(
  ({ title, description, headerEnd, headingLevel: Heading = "h2", headingId, className, children, ...props }, ref) => {
    const generatedId = React.useId();
    const id = headingId ?? generatedId;
    return <section ref={ref} aria-labelledby={id} className={cn("min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-6", className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><Heading id={id} className="text-base font-semibold">{title}</Heading>{description && <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>}</div>
        {headerEnd && <div className="flex shrink-0 items-center gap-2">{headerEnd}</div>}
      </div>
      {children && <div className="mt-4 min-w-0">{children}</div>}
    </section>;
  },
);
SectionCard.displayName = "SectionCard";
