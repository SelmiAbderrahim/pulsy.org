import type { i18n } from "i18next";
import type { QueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "./session-query-client";

/** Only the account that requested a language may commit the global locale. */
export async function changeSessionLanguage(instance: i18n, client: QueryClient, language: string): Promise<boolean> {
  if (!isSessionClientActive(client)) return false;
  await new Promise<void>((resolve, reject) => {
    void instance.loadLanguages(language, error => error ? reject(error) : resolve());
  });
  // loadLanguages can resolve immediately for an already pending preload.
  // loadResources joins the backend queue for the entire preload set that
  // changeLanguage will use, so its global commit has no pending HTTP work.
  await new Promise<void>((resolve, reject) => {
    instance.loadResources(error => error ? reject(error) : resolve());
  });
  if (!isSessionClientActive(client)) return false;
  await instance.changeLanguage(language);
  return isSessionClientActive(client);
}
