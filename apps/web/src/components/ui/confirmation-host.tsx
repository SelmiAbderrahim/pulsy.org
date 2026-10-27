import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation";
import { registerConfirmationHandler } from "@/lib/confirmation";

export function ConfirmationHost() {
  const { t } = useTranslation("common");
  const { confirm, dialog } = useConfirmation();
  useLayoutEffect(() => registerConfirmationHandler((description, options) => confirm({
    title: options.title, description,
    action: options.action ?? t("actions.confirm"), destructive: options.variant ? options.variant === "destructive" : options.destructive ?? true,
    confirmationName: options.confirmationName,
  })), [confirm, t]);
  return dialog;
}
