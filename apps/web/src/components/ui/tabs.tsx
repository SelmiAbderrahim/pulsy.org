import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ dir, className, ...props }, ref) => {
  const { i18n } = useTranslation();
  return <TabsPrimitive.Root ref={ref} className={cn("min-w-0", className)} dir={dir ?? (i18n?.language?.split("-")[0] === "ar" ? "rtl" : "ltr")} {...props} />;
});
Tabs.displayName = "Tabs";

// Width of the edge fade that signals "more tabs this way".
const EDGE = 28;

/**
 * The tab strip is the scroll container. When tabs overflow, the edge that still has hidden tabs
 * fades out, and the selected tab is kept in view without scrolling anything else on the page.
 * Semantics, arrow-key roving focus, RTL and URL-driven selection stay Radix' own.
 */
const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, style, onScroll, ...props }, forwardedRef) => {
	const listRef = React.useRef<HTMLDivElement | null>(null);
	const [fade, setFade] = React.useState({ left: false, right: false, width: 0 });
	const setRefs = (node: HTMLDivElement | null) => {
		listRef.current = node;
		if (typeof forwardedRef === "function") forwardedRef(node);
		else if (forwardedRef) forwardedRef.current = node;
	};
	const measure = React.useCallback(() => {
		const list = listRef.current;
		if (!list) return;
		const rtl = getComputedStyle(list).direction === "rtl";
		const offset = Math.abs(list.scrollLeft);
		const hiddenStart = offset > 1;
		const hiddenEnd = offset < list.scrollWidth - list.clientWidth - 1;
		const next = { ...(rtl ? { left: hiddenEnd, right: hiddenStart } : { left: hiddenStart, right: hiddenEnd }), width: list.clientWidth };
		setFade((previous) => (previous.left === next.left && previous.right === next.right && previous.width === next.width ? previous : next));
	}, []);

	React.useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const reveal = () => {
			const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
			if (!active) return;
			const bounds = list.getBoundingClientRect();
			const tab = active.getBoundingClientRect();
			if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left - 8;
			else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right + 8;
		};
		reveal();
		measure();
		// A resize (e.g. a page scrollbar appearing once content loads) can push the selected tab out again.
		const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { reveal(); measure(); });
		resize?.observe(list);
		const mutations = new MutationObserver(() => { reveal(); measure(); });
		mutations.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"], childList: true });
		return () => { resize?.disconnect(); mutations.disconnect(); };
	}, [measure]);

	const mask = fade.left || fade.right
		? `linear-gradient(to right, ${fade.left ? "transparent 0" : "#000 0"}, #000 ${EDGE}px, #000 ${Math.max(EDGE, fade.width - EDGE)}px, ${fade.right ? "transparent 100%" : "#000 100%"})`
		: undefined;
	return (
		<TabsPrimitive.List
			ref={setRefs}
			data-fade-left={fade.left || undefined}
			data-fade-right={fade.right || undefined}
			onScroll={(event) => { measure(); onScroll?.(event); }}
			style={{ ...style, ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}) }}
			className={cn(
				"inline-flex max-w-full min-h-[44px] items-center justify-start gap-1 overflow-x-auto rounded-md bg-muted p-1 text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xs px-3 py-2 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs",
			className,
		)}
		{...props}
	/>
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn(
			"mt-4 min-w-0 ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			className,
		)}
		{...props}
	/>
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
