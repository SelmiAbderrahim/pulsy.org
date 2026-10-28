import * as React from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlayFocusReturn } from "./overlay-focus";
import { useReadyTriggerProps } from "./control-readiness";

const MenuFocus = React.createContext<{
  focusReturn: ReturnType<typeof useOverlayFocusReturn>;
  trigger: React.MutableRefObject<HTMLButtonElement | null>;
  interactedOutside: React.MutableRefObject<boolean>;
  escapeHandler: React.MutableRefObject<((event: KeyboardEvent) => void) | undefined>;
  handleEscape: (event: React.KeyboardEvent<HTMLElement>) => void;
} | null>(null);
function DropdownMenu({ modal = false, dir, open: controlledOpen, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const { i18n } = useTranslation();
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const focusReturn = useOverlayFocusReturn();
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const interactedOutside = React.useRef(false);
  const escapeHandler = React.useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) { interactedOutside.current = false; focusReturn.capture(trigger.current); }
    if (controlledOpen === undefined) setLocalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const handleEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || !open) return;
    // Radix's document listener uses a cached layer index. During its first
    // registration frame that index can still be -1, leaving Escape unhandled.
    // A local handler exists from commit and only fills that unhandled gap.
    escapeHandler.current?.(event.nativeEvent);
    if (event.defaultPrevented || event.nativeEvent.defaultPrevented) return;
    event.preventDefault();
    changeOpen(false);
  };
  return <MenuFocus.Provider value={{ focusReturn, trigger, interactedOutside, escapeHandler, handleEscape }}><DropdownMenuPrimitive.Root modal={modal} dir={dir ?? (i18n?.language?.startsWith("ar") ? "rtl" : "ltr")} {...props} open={open} onOpenChange={changeOpen} /></MenuFocus.Provider>;
}
const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>((props, ref) => {
  const readiness = useReadyTriggerProps(props);
  const context = React.useContext(MenuFocus);
  const trigger = context?.trigger;
  const composedRef = React.useCallback((element: HTMLButtonElement | null) => {
    if (trigger) trigger.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }, [trigger, ref]);
  return <DropdownMenuPrimitive.Trigger {...props} {...readiness} ref={composedRef} onKeyDown={event => { props.onKeyDown?.(event); context?.handleEscape(event); }} />;
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
		inset?: boolean;
	}
>(({ className, inset, children, ...props }, ref) => (
	<DropdownMenuPrimitive.SubTrigger
		ref={ref}
		className={cn(
			"flex min-h-11 cursor-default select-none items-center rounded-xs px-2 py-1.5 text-sm outline-hidden focus:bg-accent data-[state=open]:bg-accent",
			inset && "ps-8",
			className,
		)}
		{...props}
	>
		{children}
		<ChevronRight className="ms-auto h-4 w-4 rtl:scale-x-[-1]" />
	</DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

const DropdownMenuSubContent = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
	<DropdownMenuPrimitive.SubContent
		ref={ref}
		className={cn(
			"z-50 min-w-[8rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-xs data-[state=open]:animate-in data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
	/>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

const DropdownMenuContent = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const context = React.useContext(MenuFocus);
  if (context) context.escapeHandler.current = props.onEscapeKeyDown;
  const contextRef = React.useRef(context);
  contextRef.current = context;
  const mountedContent = React.useRef<HTMLDivElement | null>(null);
  const composedRef = React.useCallback((element: HTMLDivElement | null) => {
    // Runs whenever the portalled content mounts, including defaultOpen roots.
    // Keep the callback stable so ordinary rerenders cannot recapture a new dialog.
    if (element && element !== mountedContent.current && contextRef.current) {
      mountedContent.current = element;
      contextRef.current.interactedOutside.current = false;
      contextRef.current.focusReturn.capture(contextRef.current.trigger.current);
    }
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }, [ref]);
  return (
	<DropdownMenuPrimitive.Portal>
		<DropdownMenuPrimitive.Content
			ref={composedRef}
			sideOffset={sideOffset}
			className={cn(
				"z-50 min-w-[8rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-xs data-[state=open]:animate-in data-[state=open]:fade-in-0",
				className,
			)}
			{...props}
      onKeyDown={event => {
        props.onKeyDown?.(event);
        // A submenu or a portalled dialog owns its own Escape behavior.
        if (event.target instanceof HTMLElement && event.target.closest("[data-radix-menu-content]") === event.currentTarget) context?.handleEscape(event);
      }}
      onInteractOutside={event => { props.onInteractOutside?.(event); if (!event.defaultPrevented && context) context.interactedOutside.current = true; }}
      onCloseAutoFocus={event => {
        props.onCloseAutoFocus?.(event);
        if (!context?.interactedOutside.current) context?.focusReturn.restore(event);
      }}
		/>
	</DropdownMenuPrimitive.Portal>
); });
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
		inset?: boolean;
	}
>(({ className, inset, ...props }, ref) => (
	<DropdownMenuPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex min-h-[44px] cursor-default select-none items-center gap-2 rounded-xs px-2 py-2 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			inset && "ps-8",
			className,
		)}
		{...props}
	/>
));
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuCheckboxItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
	<DropdownMenuPrimitive.CheckboxItem
		ref={ref}
		className={cn(
			"relative flex min-h-[44px] cursor-default select-none items-center rounded-xs py-2 pe-2 ps-8 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		checked={checked}
		{...props}
	>
		<span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				<Check className="h-4 w-4" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

const DropdownMenuRadioItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
	<DropdownMenuPrimitive.RadioItem
		ref={ref}
		className={cn(
			"relative flex min-h-[44px] cursor-default select-none items-center rounded-xs py-2 pe-2 ps-8 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		{...props}
	>
		<span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				<Circle className="h-2 w-2 fill-current" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

const DropdownMenuLabel = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
		inset?: boolean;
	}
>(({ className, inset, ...props }, ref) => (
	<DropdownMenuPrimitive.Label
		ref={ref}
		className={cn("px-2 py-1.5 text-sm font-semibold", inset && "ps-8", className)}
		{...props}
	/>
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<DropdownMenuPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-muted", className)}
		{...props}
	/>
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

const DropdownMenuShortcut = ({
	className,
	...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
	<span
		className={cn("ms-auto text-xs tracking-widest opacity-60", className)}
		{...props}
	/>
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuGroup,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuRadioGroup,
};
