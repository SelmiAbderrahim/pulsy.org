import { z } from "zod";

/** Shared browser/API policy. Normalize on validation/save, never while typing. */
export const statusPageSlugSchema = z.string().trim().toLowerCase()
	.min(1).max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
