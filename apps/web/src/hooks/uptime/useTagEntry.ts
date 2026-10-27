import { useCallback, useState } from "react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { addTagEntry, hasTagSeparator, splitPendingTagInput } from "@/lib/uptime/tag-input";

/**
 * Wires one tag text field to a tag list: Enter, blur and a typed comma commit
 * the entry; commas split it into separate tags. Callers own both values so
 * draft comparison keeps seeing the pending text.
 */
export function useTagEntry({ tags, setTags, input, setInput }: {
	tags: string[];
	setTags: (tags: string[]) => void;
	input: string;
	setInput: (value: string) => void;
}) {
	const { t } = useTranslation("uptimeMonitor");
	const [feedback, setFeedback] = useState("");
	const apply = useCallback((entry: string) => {
		const result = addTagEntry(tags, entry);
		if (result.added.length) setTags(result.tags);
		setFeedback(result.duplicates ? t("tags.duplicate") : result.split ? t("tags.commaSeparated") : "");
	}, [tags, setTags, t]);
	const commit = useCallback(() => {
		if (input.trim()) apply(input);
		setInput("");
	}, [apply, input, setInput]);
	const onChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const value = event.target.value;
		if (!hasTagSeparator(value)) { setInput(value); setFeedback(""); return; }
		const { complete, pending } = splitPendingTagInput(value);
		apply(complete);
		setInput(pending);
	}, [apply, setInput]);
	const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && !event.nativeEvent.isComposing) {
			event.preventDefault();
			commit();
		}
	}, [commit]);
	const reset = useCallback(() => setFeedback(""), []);
	return { commit, onChange, onKeyDown, feedback, reset };
}
