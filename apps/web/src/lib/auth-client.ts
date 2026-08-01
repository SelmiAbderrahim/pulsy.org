/**
 * better-auth client (email/password only).
 *
 * The base URL points at the server's auth mount. In development Vite proxies
 * `/api/*` to the backend, so the default is same-origin. `VITE_SERVER_URL`
 * overrides for non-proxied environments.
 *
 * @module lib/auth-client
 */

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

/**
 * better-auth requires an absolute base URL in the browser (it parses it with
 * `new URL(...)`). When `VITE_SERVER_URL` is unset we default to the current
 * origin so requests stay same-origin and nginx proxies `/api/*` to the server.
 */
const configuredServerUrl = import.meta.env.VITE_SERVER_URL?.trim();
const SERVER_URL: string =
	configuredServerUrl ||
	(typeof window !== "undefined" ? window.location.origin : "");

export const authClient = createAuthClient({
	baseURL: `${SERVER_URL}/api/auth`,
	// Mirror the server's `user.additionalFields` so `session.user.role` /
	// `.banned` are typed on the client (used to gate the /superadmin panel).
	plugins: [
		inferAdditionalFields({
			user: {
				role: { type: "string", input: false },
				banned: { type: "boolean", input: false },
			},
		}),
	],
});

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
} = authClient;
