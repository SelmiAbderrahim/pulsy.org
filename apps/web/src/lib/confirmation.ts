import i18n from "i18next";
import { isRepeatedConfirmationText } from "./confirmation-text";

export { isRepeatedConfirmationText };

/** `title` names the action; the description passed alongside it must add the consequence. */
export type ConfirmationOptions = { title: string; action?: string; destructive?: boolean; variant?: "default" | "destructive"; confirmationName?: string };
type Handler = (description: string, options: ConfirmationOptions) => Promise<boolean>;
let handler: Handler | null = null;
export function registerConfirmationHandler(next: Handler) {
  handler = next;
  return () => { if (handler === next) handler = null; };
}
/** Application confirmations always use the mounted themed host; fail closed before readiness. */
export function requestConfirmation(description: string, options: ConfirmationOptions): Promise<boolean> {
  const destructive = options.variant ? options.variant === "destructive" : options.destructive ?? true;
  if (!options.title?.trim() || isRepeatedConfirmationText(options.title, description)) {
    return Promise.reject(new Error("Confirmations require a title distinct from their description"));
  }
  if (destructive && /^(confirm|confirmation)$/i.test(options.title.trim())) {
    return Promise.reject(new Error("Destructive confirmations require a specific title"));
  }
  return handler ? handler(description, options) : Promise.resolve(false);
}
/** Shared guard before an action throws away an unsaved draft. */
export function requestDiscardConfirmation(): Promise<boolean> {
  const discard = i18n.t("common:actions.discard");
  return requestConfirmation(i18n.t("common:nav.discard"), { title: discard, action: discard });
}
