import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SourceCodeOffer } from "@/components/source-code-offer";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<>
			<Outlet />
			<SourceCodeOffer />
			<Toaster position="bottom-right" richColors closeButton />
		</>
	);
}
