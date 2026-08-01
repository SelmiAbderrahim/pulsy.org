/**
 * Returns a debounced copy of a rapidly-changing value. The debounced value
 * only updates after `delayMs` has elapsed without further changes.
 *
 * @module hooks/useDebouncedValue
 */

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 200): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}
