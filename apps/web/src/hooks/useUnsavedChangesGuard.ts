import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { requestConfirmation } from "@/lib/confirmation";
import { useDirtyBeforeUnload } from "./use-dirty-before-unload";

/** Protect route/tab changes through the shared themed confirmation host. */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const { t } = useTranslation("uptimeMonitor");
  useDirtyBeforeUnload(isDirty);
  // Unit tests for the form components intentionally render outside a router.
  // The browser guard is simply unavailable in that isolated environment.
  try {
    useBlocker({
      disabled: !isDirty,
      enableBeforeUnload: false,
      shouldBlockFn: async ({ current, next }) => {
        const tab = (search: unknown) => search && typeof search === "object" && "tab" in search ? search.tab : undefined;
        if (current.pathname === next.pathname && tab(current.search) === tab(next.search)) return false;
        return !await requestConfirmation(t("common:nav.leaveDescription"), {
          title: t("common:nav.leaveWithoutSaving", "Leave without saving?"), action: t("communication.discard"), destructive: true,
        });
      },
    });
  } catch {
    // No router context: retain beforeunload protection and form behavior.
  }
}
