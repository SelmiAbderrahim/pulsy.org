import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Small, translated metadata payload for the SPA shell, before its bundle loads. */
export function privateTitleResources(root: string) {
  return Object.fromEntries(["en", "ar", "fr", "de", "es"].map(locale => {
    const read = (namespace: string) => JSON.parse(readFileSync(path.join(root, "public/locales", locale, `${namespace}.json`), "utf8"));
    const common = read("common"), uptime = read("uptimeMonitor");
    return [locale, { nav: common.nav, monitorTabs: uptime.tabs, statusTabs: uptime.statusUX?.tabs ?? {}, help: uptime.help?.title ?? common.nav.help }];
  }));
}

export function privateMetadata(): Plugin {
  return { name: "pulsy-private-metadata", transformIndexHtml: {
    order: "pre",
    handler: () => [{ tag: "script", attrs: { id: "pulsy-private-titles", type: "application/json" }, children: JSON.stringify(privateTitleResources(import.meta.dirname)).replace(/</g, "\\u003c"), injectTo: "head-prepend" }],
  } };
}
