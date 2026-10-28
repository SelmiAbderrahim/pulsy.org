import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "./use-confirmation";
import { useDirtyBeforeUnload } from "./use-dirty-before-unload";

export function useDirtyNavigation(dirty: boolean | (() => boolean), onDiscard?: () => void) {
  const { t } = useTranslation("uptimeMonitor");
  const { confirm, dialog } = useConfirmation();
  useDirtyBeforeUnload(dirty);
  useBlocker({ disabled: dirty === false, enableBeforeUnload: false, shouldBlockFn: async ({ current, next }) => {
    if (typeof dirty === "function" && !dirty()) return false;
    if (current.pathname === next.pathname && JSON.stringify(current.search) === JSON.stringify(next.search)) return false;
    const accepted = await confirm({ title: t("common:nav.leaveWithoutSaving", "Leave without saving?"), description: t("common:nav.leaveDescription"), action: t("communication.discard") });
    if (accepted) onDiscard?.();
    return !accepted;
  } });
  return dialog;
}
