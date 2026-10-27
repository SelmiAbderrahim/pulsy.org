/**
 * Shared tag entry rules for every monitor tag field.
 *
 * Commas (ASCII, Arabic and full-width) separate tags, so a single tag can
 * never contain one. Parts are trimmed, empty parts dropped and duplicates
 * (against the current list and within the entry) ignored. Stored tags are
 * never rewritten here; this only governs new input.
 */
export const MAX_MONITOR_TAGS = 10;
export const MAX_TAG_LENGTH = 50;
const SEPARATOR = /[,،，]/;

export type TagEntryResult = {
	tags: string[];
	/** Values added by this entry, in order. */
	added: string[];
	/** The entry contained a separator and was split into several tags. */
	split: boolean;
	duplicates: number;
	/** Parts dropped because the tag limit was reached. */
	overflow: number;
};

export function hasTagSeparator(value: string): boolean {
	return SEPARATOR.test(value);
}

export function addTagEntry(current: readonly string[], entry: string, max = MAX_MONITOR_TAGS): TagEntryResult {
	const tags = [...current];
	const added: string[] = [];
	let duplicates = 0, overflow = 0;
	for (const part of entry.split(SEPARATOR)) {
		const tag = part.trim().slice(0, MAX_TAG_LENGTH);
		if (!tag) continue;
		if (tags.includes(tag)) { duplicates += 1; continue; }
		if (tags.length >= max) { overflow += 1; continue; }
		tags.push(tag);
		added.push(tag);
	}
	return { tags, added, split: hasTagSeparator(entry), duplicates, overflow };
}

/** Splits typed text into the finished part (before the last separator) and the part still being typed. */
export function splitPendingTagInput(value: string): { complete: string; pending: string } {
	const parts = value.split(SEPARATOR);
	const pending = parts.pop() ?? "";
	return { complete: parts.join(","), pending };
}
