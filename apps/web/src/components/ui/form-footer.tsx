import * as React from "react";
import { cn } from "@/lib/utils";
export interface FormFooterProps extends React.HTMLAttributes<HTMLDivElement> { sticky?: boolean }
export const FormFooter = React.forwardRef<HTMLDivElement, FormFooterProps>(
  ({ sticky = false, className, ...props }, ref) => {
    const element = React.useRef<HTMLDivElement | null>(null);
    React.useLayoutEffect(() => {
      const footer = element.current;
      const form = footer?.closest("form");
      if (!sticky || !footer || !form) return;
      const previous = form.style.getPropertyValue("--sticky-footer-height");
      const measure = () => form.style.setProperty("--sticky-footer-height", `${footer.getBoundingClientRect().height}px`);
      measure();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      observer?.observe(footer);
      return () => {
        observer?.disconnect();
        if (previous) form.style.setProperty("--sticky-footer-height", previous);
        else form.style.removeProperty("--sticky-footer-height");
      };
    }, [sticky]);
    return <div ref={node => { element.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} data-sticky-form-footer={sticky || undefined} className={cn(
    "flex flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
    sticky && "sticky bottom-0 z-10 bg-background pb-4",
    className,
  )} {...props} />;
  },
);
FormFooter.displayName = "FormFooter";
