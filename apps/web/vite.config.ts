import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	ssr: {
		noExternal: true,
	},
	server: {
		host: true,
		port: Number(process.env.WEB_PORT ?? 3000),
		proxy: {
			// Dev convenience: proxy API + auth to the server so the browser
			// uses a same-origin path and cookies just work.
			"/api": {
				target: process.env.PUBLIC_SERVER_URL ?? "http://localhost:4000",
				changeOrigin: true,
			},
		},
	},
	preview: {
		host: true,
		port: Number(process.env.WEB_PORT ?? 3000),
	},
});
