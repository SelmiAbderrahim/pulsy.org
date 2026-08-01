import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useDebouncedValue", () => {
	it("returns the initial value immediately", () => {
		const { result } = renderHook(() => useDebouncedValue("a", 200));
		expect(result.current).toBe("a");
	});

	it("updates only after the delay elapses", () => {
		const { result, rerender } = renderHook(
			({ value }) => useDebouncedValue(value, 200),
			{ initialProps: { value: "a" } },
		);
		rerender({ value: "b" });
		expect(result.current).toBe("a");
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(result.current).toBe("b");
	});

	it("uses the default delay when none is provided", () => {
		const { result, rerender } = renderHook(
			({ value }) => useDebouncedValue(value),
			{ initialProps: { value: "a" } },
		);
		rerender({ value: "b" });
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(result.current).toBe("b");
	});
});
