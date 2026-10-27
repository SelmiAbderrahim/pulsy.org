import { useEffect } from "react";

/** Titles follow loaded data and URL state without remounting private drafts. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} | Pulsy`;
  }, [title]);
}
