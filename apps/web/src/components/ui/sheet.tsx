import { isToastInteraction } from "@/lib/toast-interaction";
import * as React from "react";
import { useModalBackdrop } from "./modal-backdrop";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { focusOverlayStart, useOverlayFocusReturn } from "./overlay-focus";
import { useReadyTriggerProps } from "./control-readiness";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Trigger>
>((props, ref) => {
  const readiness = useReadyTriggerProps(props);
  return <SheetPrimitive.Trigger {...props} {...readiness} ref={ref} />;
});
SheetTrigger.displayName = SheetPrimitive.Trigger.displayName;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const backdropRef = useModalBackdrop(ref);
  return (
	<SheetPrimitive.Overlay
		className={cn(
			"fixed inset-0 z-50 bg-black/80 data-[dimmed=false]:bg-transparent data-[state=open]:animate-in data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
		ref={backdropRef}
    data-modal-backdrop=""
	/>
); });
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
	"fixed z-50 gap-4 overflow-y-auto bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xs transition-opacity duration-200 data-[state=open]:animate-in sm:p-6",
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 border-b data-[state=open]:slide-in-from-top",
				bottom:
					"inset-x-0 bottom-0 border-t data-[state=open]:slide-in-from-bottom",
				left: "inset-y-0 start-0 h-dvh w-full border-e data-[state=open]:slide-in-from-left rtl:data-[state=open]:slide-in-from-right sm:max-w-md",
				right:
					"inset-y-0 end-0 h-dvh w-full border-s data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left sm:max-w-md",
			},
		},
		defaultVariants: {
			side: "right",
		},
	},
);

interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
		VariantProps<typeof sheetVariants> {
  container?: HTMLElement | null;
  hideClose?: boolean;
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(({ side = "right", className, children, container, hideClose = false, ...props }, ref) => {
 const { t } = useTranslation("common");
 const returnFocus = useOverlayFocusReturn();
 return (
	<SheetPortal container={container}>
		<SheetOverlay />
		<SheetPrimitive.Content
			ref={ref}
			className={cn(sheetVariants({ side }), className)}
			{...props}
			onOpenAutoFocus={event => { returnFocus.capture(); props.onOpenAutoFocus?.(event); focusOverlayStart(event); }}
			onCloseAutoFocus={event => { props.onCloseAutoFocus?.(event); returnFocus.restore(event); }}
      onPointerDownOutside={event => { if (isToastInteraction(event)) { event.preventDefault(); return; } props.onPointerDownOutside?.(event); }}
		>
			{children}
			{!hideClose && <SheetPrimitive.Close data-overlay-close className="absolute z-10 end-2 top-2 flex h-[44px] w-[44px] items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:end-3 sm:top-3">
				<X className="h-4 w-4" />
				<span className="sr-only">{t("actions.close")}</span>
			</SheetPrimitive.Close>}
		</SheetPrimitive.Content>
	</SheetPortal>
); });
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col gap-2 pe-10 text-start",
			className,
		)}
		{...props}
	/>
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
			className,
		)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
    data-overlay-title
    tabIndex={-1}
		ref={ref}
		className={cn("text-lg font-semibold text-foreground focus:outline-hidden", className)}
		{...props}
	/>
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
	Sheet,
	SheetPortal,
	SheetOverlay,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
