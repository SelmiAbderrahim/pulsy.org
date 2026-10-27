import { useEffect } from "react";

/** Browser-level reload/close warnings exist only while a draft is dirty. */
export function useDirtyBeforeUnload(dirty: boolean | (() => boolean)) {
  useEffect(() => {
    if (dirty === false) return;
    const warn = (event: BeforeUnloadEvent) => { if (typeof dirty === "function" && !dirty()) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
