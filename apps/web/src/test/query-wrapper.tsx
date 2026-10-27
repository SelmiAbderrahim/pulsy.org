import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/**
 * Build a QueryClient with retries disabled so error paths resolve immediately
 * and tests stay deterministic.
 */
export function createTestQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
}

/**
 * Render-wrapper factory that provides a fresh QueryClient. Returns both the
 * wrapper and the client so tests can spy on cache operations.
 */
export function createWrapper(client = createTestQueryClient()) {
	const Wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return { Wrapper, client };
}

/** Isolated form tests still use the same session-client context as the app. */
export function renderWithQueryClient(ui: ReactElement): Pick<RenderResult, "container" | "baseElement" | "rerender" | "unmount" | "asFragment"> & { client: QueryClient } {
  const { Wrapper, client } = createWrapper();
  return { client, ...render(ui, { wrapper: Wrapper }) };
}
