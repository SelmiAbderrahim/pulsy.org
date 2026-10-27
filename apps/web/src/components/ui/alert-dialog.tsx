/**
 * Alert dialog primitives.
 *
 * Built on top of `@radix-ui/react-dialog` (already a dependency) rather than
 * `@radix-ui/react-alert-dialog` to avoid an extra package. The API surface
 * (AlertDialog*, AlertDialogAction/Cancel) mirrors the shadcn alert-dialog so
 * consumers are unchanged.
 */

import { isToastInteraction } from "@/lib/toast-interaction";
import * as React from "react";
import { useModalBackdrop } from "./modal-backdrop";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AlertDialog = DialogPrimitive.Root;
const AlertDialogTrigger = DialogPrimitive.Trigger;
const AlertDialogPortal = DialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const backdropRef = useModalBackdrop(ref);
  return (
	<DialogPrimitive.Overlay
		className={cn(
			"fixed inset-0 z-[60] bg-black/80 data-[dimmed=false]:bg-transparent data-[state=open]:animate-in data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
		ref={backdropRef}
    data-modal-backdrop=""
	/>
); });
AlertDialogOverlay.displayName = "AlertDialogOverlay";

const AlertDialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, ...props }, ref) => (
	<AlertDialogPortal>
		<AlertDialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"fixed start-[50%] top-[50%] z-[60] grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[var(--dialog-simple)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border bg-background p-4 shadow-xs duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:p-6 rtl:translate-x-[50%]",
				className,
			)}
			{...props}
      onPointerDownOutside={event => { if (isToastInteraction(event)) { event.preventDefault(); return; } props.onPointerDownOutside?.(event); }}
		/>
	</AlertDialogPortal>
));
AlertDialogContent.displayName = "AlertDialogContent";

const AlertDialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col space-y-2 text-center sm:text-start",
			className,
		)}
		{...props}
	/>
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({
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
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn("text-lg font-semibold", className)}
		{...props}
	/>
));
AlertDialogTitle.displayName = "AlertDialogTitle";

const AlertDialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
AlertDialogDescription.displayName = "AlertDialogDescription";

const AlertDialogAction = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
	<button
		ref={ref}
		className={cn(buttonVariants(), className)}
		{...props}
	/>
));
AlertDialogAction.displayName = "AlertDialogAction";

const AlertDialogCancel = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Close asChild>
		<button
			ref={ref}
			className={cn(buttonVariants({ variant: "outline" }), className)}
			{...props}
		/>
	</DialogPrimitive.Close>
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
	AlertDialog,
	AlertDialogPortal,
	AlertDialogOverlay,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
};
