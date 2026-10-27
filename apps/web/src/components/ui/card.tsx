import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn(
			"rounded-lg border bg-card text-card-foreground shadow-xs",
			className,
		)}
		{...props}
	/>
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex flex-col space-y-1.5 p-6", className)}
		{...props}
	/>
));
CardHeader.displayName = "CardHeader";

/** A card's title is its section heading: `h2` under the page's `h1` unless a different level fits the nesting. */
type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" };
const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
	({ className, as: Heading = "h2", ...props }, ref) => (
		<Heading
			ref={ref}
			className={cn(
				"text-2xl font-semibold leading-none tracking-tight",
				className,
			)}
			{...props}
		/>
	),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex items-center p-6 pt-0", className)}
		{...props}
	/>
));
CardFooter.displayName = "CardFooter";

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardDescription,
	CardContent,
};
