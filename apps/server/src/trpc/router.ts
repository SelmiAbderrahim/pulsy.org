import { router } from "./trpc";
import { uptimeRouter } from "./routers/uptime";
import { configRouter } from "./routers/config";
import { organizationRouter } from "./routers/organization";
import { apiKeyRouter } from "./routers/api-key";
import { adminRouter } from "./routers/admin";

export const appRouter = router({
	uptimeMonitor: uptimeRouter,
	config: configRouter,
	organization: organizationRouter,
	apiKey: apiKeyRouter,
	admin: adminRouter,
});

export type AppRouter = typeof appRouter;
