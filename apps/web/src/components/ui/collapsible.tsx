import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type DisclosureState = { open: boolean; disabled: boolean; contentId: string; triggerId: string; toggle: () => void };
const DisclosureContext = React.createContext<DisclosureState | null>(null);
function useDisclosure() {
  const context = React.useContext(DisclosureContext);
  if (!context) throw new Error("CollapsibleTrigger and CollapsibleContent require Collapsible");
  return context;
}
export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}
export const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ open: controlledOpen, defaultOpen = false, onOpenChange, disabled = false, className, children, ...props }, ref) => {
    const [uncontrolledOpen, setOpen] = React.useState(defaultOpen);
    const id = React.useId();
    const open = controlledOpen ?? uncontrolledOpen;
    const toggle = () => {
      if (disabled) return;
      if (controlledOpen === undefined) setOpen(!open);
      onOpenChange?.(!open);
    };
    return <DisclosureContext.Provider value={{ open, disabled, contentId: `${id}-content`, triggerId: `${id}-trigger`, toggle }}>
      <div ref={ref} className={cn("min-w-0", className)} data-state={open ? "open" : "closed"} {...props}>{children}</div>
    </DisclosureContext.Provider>;
  },
);
Collapsible.displayName = "Collapsible";
export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, onClick, disabled, ...props }, ref) => {
    const disclosure = useDisclosure();
    return <button {...props} ref={ref} type="button" id={disclosure.triggerId} disabled={disabled || disclosure.disabled}
      aria-expanded={disclosure.open} aria-controls={disclosure.contentId} data-state={disclosure.open ? "open" : "closed"}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) disclosure.toggle(); }}
      className={cn("relative flex min-h-[var(--control-height)] w-full items-center rounded-md py-3 pe-10 text-start text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)}>
      <span className="min-w-0 flex-1">{children}</span>
      <span aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center"><ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-150", disclosure.open && "rotate-180")} /></span>
    </button>;
  },
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";
export const CollapsibleContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const disclosure = useDisclosure();
    return <div {...props} ref={ref} id={disclosure.contentId} role="region" aria-labelledby={disclosure.triggerId} hidden={!disclosure.open} data-state={disclosure.open ? "open" : "closed"} className={cn("min-w-0 p-4", className)} />;
  },
);
CollapsibleContent.displayName = "CollapsibleContent";
