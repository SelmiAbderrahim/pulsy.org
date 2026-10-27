import { useCallback, useRef, type ForwardedRef } from "react";

// Portals share the same visual stack, including sheets and confirmation dialogs.
// Keep lower backdrops mounted for Radix's modal behavior but remove their tint.
const backdrops = new Set<HTMLDivElement>();
function updateBackdrops() {
  const ordered = [...backdrops].filter(node => node.isConnected).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  for (const node of ordered) node.dataset.dimmed = String(node === ordered.at(-1));
}

export function useModalBackdrop(forwardedRef: ForwardedRef<HTMLDivElement>) {
  const current = useRef<HTMLDivElement | null>(null);
  return useCallback((node: HTMLDivElement | null) => {
    if (current.current) backdrops.delete(current.current);
    current.current = node;
    if (node) backdrops.add(node);
    updateBackdrops();
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
}
