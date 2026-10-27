import { initializeTheme } from "./components/theme-toggle";
import { SessionQueryBoundary } from "./components/auth/session-query-boundary";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { HelmetProvider } from "@dr.pogodin/react-helmet";

import i18n, { i18nReady, NAMESPACES } from "./i18n";
import "./styles/globals.css";
import { routeTree } from "./routeTree.gen";

import { captureSubscriptionCapability } from "./lib/uptime/public-subscription-capability";

initializeTheme();
captureSubscriptionCapability();
window.addEventListener("hashchange", captureSubscriptionCapability);

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

router.subscribe("onResolved", captureSubscriptionCapability);

void i18nReady.then(() => {
	const language = document.documentElement.dataset.initialLocale ?? i18n.language;
	if (!NAMESPACES.every(namespace => i18n.hasResourceBundle(language, namespace))) {
		const loading = document.getElementById("locale-loading");
		if (loading) {
			loading.textContent = ({
				en: "Pulsy could not load. Reload to try again.",
				ar: "تعذّر تحميل Pulsy. أعد تحميل الصفحة للمحاولة مجددًا.",
				fr: "Impossible de charger Pulsy. Rechargez la page pour réessayer.",
				de: "Pulsy konnte nicht geladen werden. Laden Sie die Seite erneut.",
				es: "No se pudo cargar Pulsy. Recarga la página para intentarlo de nuevo.",
			} as Record<string, string>)[language] ?? "Pulsy";
		}
		return;
	}
	createRoot(rootElement).render(
	<StrictMode>
		<Suspense fallback={<div role="status" className="grid min-h-dvh place-content-center p-4">Pulsy</div>}>
		<HelmetProvider>
			<QueryClientProvider client={queryClient}>
				<SessionQueryBoundary><RouterProvider router={router} /></SessionQueryBoundary>
			</QueryClientProvider>
		</HelmetProvider>
		</Suspense>
	</StrictMode>,
	);
});
