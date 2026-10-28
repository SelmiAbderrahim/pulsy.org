/** Postgres unique_violation, whether thrown directly or wrapped (drizzle puts it on `cause`). */
export function isUniqueViolation(error: unknown): boolean {
	for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 4; depth++) {
		if ((current as { code?: unknown }).code === "23505") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}
