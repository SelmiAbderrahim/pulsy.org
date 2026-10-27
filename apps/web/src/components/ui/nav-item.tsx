import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
export interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { asChild?: boolean; active?: boolean }
export const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(
  ({ asChild = false, active = false, className, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} {...(!asChild ? { type: "button" as const } : {})} aria-current={active ? "page" : undefined} data-active={active || undefined}
      className={cn("flex min-h-[var(--control-height)] w-full min-w-0 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-start text-sm font-medium [overflow-wrap:anywhere] transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", active ? "bg-accent text-accent-foreground" : "text-muted-foreground", className)} {...props} />;
  },
);
NavItem.displayName = "NavItem";
