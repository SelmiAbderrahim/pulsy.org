// Express `Request` augmentation for the public REST API. The API-key auth
// middleware attaches the resolved caller, the authenticating key id
// (rate-limit bucket), and a request-scoped translator.

import type { Translator } from "../lib/i18n";

declare global {
	namespace Express {
		interface Request {
			apiUser?: { id: string };
			apiKeyId?: string;
      apiKeyScope?: "read" | "full";
			apiTranslator?: Translator;
		}
	}
}

export {};
