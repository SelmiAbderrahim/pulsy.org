/**
 * SelectableCheckbox Component
 *
 * Accessible checkbox with proper touch targets and RTL support.
 * Supports indeterminate state for "select all" functionality.
 *
 * @module components/dashboard/settings/common/SelectableCheckbox
 */

import { useEffect, useRef } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectableCheckboxProps } from "@/types/bulk-selection";

/**
 * Checkbox component optimized for bulk selection scenarios.
 */
export function SelectableCheckbox({
	checked,
	indeterminate = false,
	onChange,
	disabled = false,
	label,
	className,
}: SelectableCheckboxProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const input = wrapperRef.current?.querySelector("input");
		if (input instanceof HTMLInputElement) {
			input.indeterminate = indeterminate && !checked;
		}
	}, [indeterminate, checked]);

	const handleCheckedChange = (checkedState: boolean | "indeterminate") => {
		// Radix only emits a boolean from onCheckedChange on user interaction; the
		// "indeterminate" callback value is never produced in practice.
		/* v8 ignore next 2 */
		if (checkedState === "indeterminate") {
			onChange(true);
		} else {
			onChange(checkedState);
		}
	};

	return (
		<div
			ref={wrapperRef}
			className={cn(
				"flex items-center justify-center",
				"h-[44px] w-[44px]",
				className,
			)}
		>
			<CheckboxPrimitive.Root
				checked={indeterminate ? "indeterminate" : checked}
				onCheckedChange={handleCheckedChange}
				disabled={disabled}
				aria-label={label}
				className={cn(
					"peer relative shrink-0 rounded-md border border-transparent ring-offset-background",
					"h-[44px] w-[44px]",
					"before:absolute before:start-1/2 before:top-1/2 before:h-5 before:w-5 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-xs before:border before:border-primary before:bg-background",
					"data-[state=checked]:text-primary-foreground data-[state=checked]:before:bg-primary",
					"data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:before:bg-primary",
					"focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
					"disabled:cursor-not-allowed disabled:opacity-50",
					"hover:bg-muted transition-colors",
				)}
			>
				<CheckboxPrimitive.Indicator
					className={cn(
						"absolute inset-0 z-10 flex items-center justify-center text-current",
					)}
				>
					{indeterminate && !checked ? (
						<Minus className="h-4 w-4" strokeWidth={3} />
					) : (
						<Check className="h-4 w-4" strokeWidth={3} />
					)}
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Root>
		</div>
	);
}

export default SelectableCheckbox;
