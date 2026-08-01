import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { HelmetProvider } from "@dr.pogodin/react-helmet";

import "./i18n";
import "./styles/globals.css";
import { routeTree } from "./routeTree.gen";
import { initAnalytics, trackPageView } from "./lib/analytics/gtag";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}

// Load Google Analytics 4 (no-ops when VITE_GA_MEASUREMENT_ID is unset).
initAnalytics();

// Send a page_view for the initial load and every SPA navigation. gtag is
// configured with `send_page_view: false`, so this is the only source of
// page views — fires once per resolved navigation.
router.subscribe("onResolved", ({ toLocation }) => {
	trackPageView(toLocation.href);
});

createRoot(rootElement).render(
	<StrictMode>
		<HelmetProvider>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</HelmetProvider>
	</StrictMode>,
);
