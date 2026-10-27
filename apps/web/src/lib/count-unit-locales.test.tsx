import { formattingLocale } from "@/lib/formatting-locale";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { BulkDeleteConfirmDialog } from "@/components/dashboard/settings/common/BulkDeleteConfirmDialog";
import { LatencyPolicyEditor } from "@/components/uptime/latency-policy-editor";
import { numberFormatting, numberInterpolation } from "./number-interpolation";

const locales = ["en", "ar", "fr", "de", "es"];
const families = {
  uptimeMonitor: ["detail.tls.expiresInDays", "overview.uptimeBar.daysAgo", "overview.uptimeBar.windowTitle", "overview.uptimeBar.days", "slaReport.window", "server.effectiveInterval", "server.retention", "workspace.elapsed", "communication.historyCount", "statusUX.selectedCount", "share.dialog.moreItems", "widget.up", "widget.down", "sidebar.downCount", "reliability.seconds", "server.seconds", "creation.checkCount", "creation.healthyCheckCount", "bulk.failed", "bulk.partial", "bulk.deletePartial", "pageSelection.addedCount", "pageSelection.existingCount", "pageSelection.totalCount"],
  common: ["bulkSelection.selected", "bulkSelection.confirmDelete.moreItems"],
};
const get = (resource: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], resource);
const variables = (value: string) => [...value.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map(match => match[1]).sort();
async function instance(locale: string) {
  const resources = Object.fromEntries(Object.keys(families).map(namespace => [namespace, JSON.parse(readFileSync(`public/locales/${locale}/${namespace}.json`, "utf8"))]));
  const i18n = i18next.createInstance().use(numberFormatting);
  await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: resources }, interpolation: numberInterpolation });
  return { i18n, resources };
}

describe("counted duration and selection copy", () => {
  it.each(locales)("%s has complete plural categories, consistent variables and localized visible counts", async locale => {
    const { i18n, resources } = await instance(locale);
    for (const [namespace, keys] of Object.entries(families)) {
      for (const key of keys) {
        const canonical = get(resources[namespace], `${key}_other`);
        expect(canonical, `${namespace}:${key}_other`).toEqual(expect.any(String));
        for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
          const value = get(resources[namespace], `${key}_${category}`);
          expect(value, `${locale} ${namespace}:${key}_${category}`).toEqual(expect.any(String));
          expect(variables(value as string)).toEqual(variables(canonical as string));
        }
        for (const count of [0, 1, 1.5, 2, 3, 11, 100, 1_000_000]) {
          const text = i18n.t(`${namespace}:${key}`, { count, days: count, hours: count, minutes: count, seconds: count, minimum: count, success: count, total: count, failed: "failure detail", value: new Intl.NumberFormat(formattingLocale(locale)).format(count), formattedCount: new Intl.NumberFormat(formattingLocale(locale)).format(count) });
          expect(text).not.toMatch(/\{\{|_one|_other/);
          expect(text).toContain(new Intl.NumberFormat(formattingLocale(locale)).format(count));
        }
      }
    }
  });

  it("uses singular English units for one and plural units otherwise", async () => {
    const { i18n } = await instance("en");
    expect(i18n.t("uptimeMonitor:detail.tls.expiresInDays", { count: 1, days: 1 })).toBe("Expires in 1 day");
    expect(i18n.t("uptimeMonitor:server.effectiveInterval", { count: 2, seconds: 2 })).toBe("Effective reporting interval: 2 seconds.");
  });
});


it("keeps the Arabic bulk-delete instruction identical to its accepted ASCII confirmation token", async () => {
  const { i18n } = await instance("ar");
  const onConfirm = vi.fn();
  render(<I18nextProvider i18n={i18n}><BulkDeleteConfirmDialog open onOpenChange={() => {}} items={["a", "b", "c"]} itemType="monitor" getItemName={item => item} onConfirm={onConfirm} /></I18nextProvider>);
  const confirmation = screen.getByLabelText(/DELETE 3/);
  expect(confirmation).toHaveAttribute("placeholder", "DELETE 3");
  await userEvent.type(confirmation, "DELETE 3");
  const title = i18n.t("common:bulkSelection.confirmDelete.confirm", { count: 3, type: i18n.t("common:bulkSelection.itemTypes.monitor", { count: 3 }) });
  const submit = screen.getByRole("button", { name: title });
  expect(submit).toBeEnabled();
  await userEvent.click(submit);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});


it.each(locales)("the %s policy summary independently pluralizes slow and healthy checks", async locale => {
  const { i18n } = await instance(locale);
  render(<I18nextProvider i18n={i18n}><LatencyPolicyEditor onChange={() => {}} value={{ thresholdMs: 500, recoveryThresholdMs: 300, slowCount: 3, recoveryCount: 1, importance: "critical", cooldownSeconds: 0 }} /></I18nextProvider>);
  await userEvent.click(screen.getByRole("button", { name: i18n.t("uptimeMonitor:latency.title") }));
  const check = (key: string, count: number) => i18n.t(`uptimeMonitor:creation.${key}`, { count, formattedCount: new Intl.NumberFormat(formattingLocale(locale)).format(count) });
  // Check the independently inflected fragments, including a singular recovery count.
  const summary = screen.getByText(text => text.includes(check("checkCount", 3)) && text.includes(check("healthyCheckCount", 1)));
  expect(summary).toBeVisible();
  if (locale === "en") expect(summary).toHaveTextContent("1 healthy check");
});
