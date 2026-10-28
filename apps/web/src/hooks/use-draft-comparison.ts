import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerDraftGuard } from "@/lib/draft-guards";
import { useDirtyBeforeUnload } from "./use-dirty-before-unload";

/** Compare editable values with original defaults; previews and touched state are irrelevant. */
export function useDraftComparison<T>(value: T, defaults: T = value, enabled = true) {
  const current = JSON.stringify(value);
  const [baseline, setBaseline] = useState(() => JSON.stringify(defaults));
  const wasEnabled = useRef(enabled);
  const defaultSnapshot = JSON.stringify(defaults);
  useLayoutEffect(() => {
    if (!enabled || !wasEnabled.current) setBaseline(defaultSnapshot);
    wasEnabled.current = enabled;
  }, [enabled, defaultSnapshot]);
  const dirty = enabled && current !== baseline;
  const latest = useRef({ current, dirty }); latest.current = { current, dirty };
  const reset = useCallback((accepted: T) => { latest.current.dirty = false; setBaseline(JSON.stringify(accepted)); }, []);
  const accept = () => { latest.current.dirty = false; setBaseline(latest.current.current); };
  useDirtyBeforeUnload(() => latest.current.dirty);
  useEffect(() => registerDraftGuard({ dirty: () => latest.current.dirty, discard: () => { latest.current.dirty = false; setBaseline(latest.current.current); } }), []);
  return { dirty, accept, reset, formProps: { "data-draft-dirty": dirty ? "true" : "false" } };
}
