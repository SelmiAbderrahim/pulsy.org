import { QueryClient } from "@tanstack/react-query";
import { createInstance, type ReadCallback } from "i18next";
import { expect, it } from "vitest";
import { changeSessionLanguage } from "./session-language";
import { retireSessionClient } from "./session-query-client";

it("joins an already pending language load without letting a retired second account commit it", async () => {
  const instance = createInstance();
  let release!: ReadCallback;
  instance.use({ type: "backend", read: (_language: string, _namespace: string, callback: typeof release) => { release = callback; } });
  await instance.init({ lng: "en", fallbackLng: "en", ns: ["common"], resources: { en: { common: { title: "English" } } }, partialBundledLanguages: true, initAsync: false });
  const first = new QueryClient(), second = new QueryClient();
  const firstChange = changeSessionLanguage(instance, first, "fr");
  expect(release).toEqual(expect.any(Function));
  retireSessionClient(first);
  const secondChange = changeSessionLanguage(instance, second, "fr");
  // A second loadLanguages call is already fulfilled although HTTP is pending.
  await Promise.resolve(); await Promise.resolve();
  expect(instance.language).toBe("en");
  retireSessionClient(second);
  release(null, { title: "Français" });
  expect(await firstChange).toBe(false);
  expect(await secondChange).toBe(false);
  expect(instance.language).toBe("en");
});


it("commits a fully loaded language while its requesting account remains active", async () => {
  const instance = createInstance();
  await instance.init({ lng: "en", fallbackLng: "en", ns: ["common"], resources: { en: { common: { title: "English" } }, fr: { common: { title: "Français" } } }, initAsync: false });
  expect(await changeSessionLanguage(instance, new QueryClient(), "fr")).toBe(true);
  expect(instance.language).toBe("fr");
  expect(instance.t("title")).toBe("Français");
});
