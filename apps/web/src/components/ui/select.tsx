import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useControlReady } from "./control-readiness";
import { cn } from "@/lib/utils";

function Select({dir, ...props}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const { i18n } = useTranslation();
  return <SelectPrimitive.Root dir={dir ?? (i18n?.language?.startsWith("ar") ? "rtl" : "ltr")} {...props} />;
}
export type ControlSize = "sm" | "default";
export function controlTriggerClasses(size: ControlSize = "default") {
  return cn("group/control relative flex w-full min-w-0 items-center rounded-md border border-input bg-background ps-3.5 pe-10 py-2 text-start text-sm ring-offset-background hover:border-ring/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive [&>span:first-child]:truncate", size === "sm" ? "h-9 min-h-9" : "h-[var(--control-height)] min-h-[var(--control-height)]");
}
export function ControlChevron({pending = false}: {pending?: boolean}) {
  return <span data-control-icon aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center">{pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-data-[state=open]/control:rotate-180" />}</span>;
}
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { size?: ControlSize }
>(({ className, children, size = "default", ...props }, ref) => {
  const ready = useControlReady();
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!import.meta.env.DEV || !trigger.current) return;
    const button = trigger.current;
    if (!button.getAttribute("aria-label") && !button.getAttribute("aria-labelledby") && !button.labels?.length) console.warn("SelectTrigger requires a linked Label or aria-label.");
  }, [props.id, props["aria-label"], props["aria-labelledby"]]);
  return <SelectPrimitive.Trigger ref={node => { trigger.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} className={cn(controlTriggerClasses(size), className)} {...props} disabled={props.disabled || !ready} aria-busy={!ready || undefined}>
    {children}<ControlChevron pending={!ready} />
  </SelectPrimitive.Trigger>;
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollUpButton
		ref={ref}
		className={cn(
			"flex min-h-[var(--control-height)] cursor-default items-center justify-center py-1",
			className,
		)}
		{...props}
	>
		<ChevronUp className="h-4 w-4" />
	</SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollDownButton
		ref={ref}
		className={cn(
			"flex min-h-[var(--control-height)] cursor-default items-center justify-center py-1",
			className,
		)}
		{...props}
	>
		<ChevronDown className="h-4 w-4" />
	</SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
	SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", sideOffset = 4, ...props }, ref) => (
	<SelectPrimitive.Portal>
		<SelectPrimitive.Content
			ref={ref}
			className={cn(
				"relative z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xs",
				className,
			)}
			position={position}
      sideOffset={sideOffset}
      collisionPadding={8}
      style={{maxHeight:"min(320px, var(--radix-select-content-available-height))"}}
			{...props}
		>
			<SelectScrollUpButton />
			<SelectPrimitive.Viewport
				className={cn(
					"p-1",
					position === "popper" &&
						"w-full min-w-[var(--radix-select-trigger-width)]",
				)}
			>
				{children}
			</SelectPrimitive.Viewport>
			<SelectScrollDownButton />
		</SelectPrimitive.Content>
	</SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Label
		ref={ref}
		className={cn("py-1.5 pe-2 ps-8 text-sm font-semibold", className)}
		{...props}
	/>
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { description?: React.ReactNode }
>(({ className, children, description, ...props }, ref) => {
  const descriptionId = React.useId();
  return <SelectPrimitive.Item ref={ref} className={cn("relative flex min-h-[40px] w-full cursor-default select-none items-center rounded-xs px-3 ps-8 py-2 text-sm outline-hidden hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props} aria-describedby={[props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined}>
    <span className="absolute start-2.5 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span>
    <span className="min-w-0"><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>{description && <span id={descriptionId} className="mt-1 block text-xs text-muted-foreground">{description}</span>}</span>
  </SelectPrimitive.Item>;
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-muted", className)}
		{...props}
	/>
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
	Select,
	SelectGroup,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectLabel,
	SelectItem,
	SelectSeparator,
	SelectScrollUpButton,
	SelectScrollDownButton,
};
