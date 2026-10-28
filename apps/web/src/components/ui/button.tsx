import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground",
				outline:
					"border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:bg-muted disabled:text-muted-foreground",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground",
					ghost: "hover:bg-accent hover:text-accent-foreground disabled:bg-muted disabled:text-muted-foreground",
					link: "text-primary underline-offset-4 hover:underline disabled:text-muted-foreground",
			},
			size: {
				default: "min-h-[var(--control-height)] px-4 py-2",
				sm: "min-h-[var(--control-height)] rounded-md px-3",
				lg: "h-11 rounded-md px-8",
				icon: "h-[44px] w-[44px]",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

/** A disabled control cannot receive focus; its wrapper exposes the reason. */
export function DisabledReason({ reason, children }: { reason?: string; children: React.ReactNode }) {
  if (!reason) return <>{children}</>;
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <span role="group" tabIndex={0} aria-label={reason} className="inline-flex max-w-full cursor-not-allowed rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{children}</span>
  </TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip></TooltipProvider>;
}

export { Button, buttonVariants };
