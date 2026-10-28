import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dictionary = (locale: string, namespace: string) => JSON.parse(readFileSync(`public/locales/${locale}/${namespace}.json`, "utf8"));
const value = (data: Record<string, unknown>, key: string) => key.split(".").reduce<unknown>((entry, segment) => (entry as Record<string, unknown>)[segment], data);
// Audited display copy only: plural families have their own locale regressions.
const expected = {
  "en": {
    "uptimeMonitor": {
      "actions.checkNow": "Check now",
      "actions.deleteMonitor": "Delete monitor",
      "actions.addChannel": "Add channel",
      "actions.addProvider": "Add provider",
      "quickAdd.submit": "Add monitor",
      "quickAdd.button": "Quick add",
      "bulkAdd.button": "Bulk add",
      "notificationSettings.title": "Notification settings",
      "emailProviders.title": "Email providers",
      "notificationSettings.defaults.title": "Default channels",
      "notifications.fields.channelType": "Channel type",
      "notifications.fields.notifyOnRecovery": "Notify on recovery",
      "create.fields.failureThreshold": "Failure threshold",
      "apiKeys.title": "API keys",
      "title": "Uptime monitor",
      "navigation.title": "Uptime monitor",
      "actions.createMonitor": "New monitor",
      "actions.editMonitor": "Edit monitor",
      "dashboard.totalMonitors": "Total monitors",
      "detail.lastChecked": "Last checked",
      "detail.nextCheck": "Next check",
      "detail.responseTime": "Response time",
      "detail.consecutiveFailures": "Consecutive failures",
      "detail.failureThreshold": "Failure threshold",
      "detail.httpStatus": "HTTP status",
      "detail.tls.title": "TLS certificate",
      "detail.tls.expiring": "Expiring soon",
      "overview.stats.totalChecks": "Total checks",
      "history.title": "Check history",
      "history.columns.responseTime": "Response time",
      "history.columns.httpStatus": "HTTP status",
      "notifications.fields.emailProvider": "Email provider",
      "notifications.fields.telegramTarget": "Telegram target",
      "notifications.fields.notifyOnDown": "Notify on down",
      "notifications.fields.notifyOnTlsExpiry": "Notify on TLS expiry",
      "notifications.fields.tlsExpiryThresholdDays": "TLS expiry warning days",
      "emailProviders.fields.namePlaceholder": "Example: My email provider",
      "emailProviders.fields.providerType": "Provider type",
      "emailProviders.fields.apiKey": "API key",
      "emailProviders.fields.fromAddress": "From address",
      "emailProviders.fields.smtpHost": "SMTP host",
      "emailProviders.fields.smtpPort": "SMTP port",
      "emailProviders.fields.smtpUsername": "SMTP username",
      "emailProviders.fields.smtpPassword": "SMTP password",
      "emailProviders.delete.title": "Delete provider",
      "emailProviders.testCredentials.label": "Test credentials",
      "statusPage.title": "Service status",
      "statusPage.recentIncidents": "Recent incidents",
      "statusPage.viewStatusPage": "View status page",
      "statusPage.showOnStatusPage": "Show on status page",
      "tlsMonitoring.title": "TLS certificate monitoring",
      "widget.title": "Uptime monitoring",
      "widget.viewAll": "View all",
      "widget.setupCta": "Set up monitoring",
      "emptyState.title": "Start monitoring your services",
      "emptyState.cta": "Add your first monitor",
      "onboarding.title": "New: uptime monitoring",
      "onboarding.getStarted": "Get started",
      "notificationSettings.monitorAlerts": "Monitor alerts",
      "notificationSettings.back": "Back to notifications",
      "share.manageButton": "Share links",
      "share.manage.title": "Share links",
      "slaReport.title": "SLA / uptime report"
    },
    "common": {
      "nav.apiKeys": "API keys",
      "nav.apiDocs": "API docs",
      "notFound.help": "Go to help"
    }
  },
  "fr": {
    "uptimeMonitor": {
      "onboarding.title": "Nouveau : surveillance de disponibilité"
    }
  },
  "es": {
    "uptimeMonitor": {
      "onboarding.title": "Nuevo: monitoreo de disponibilidad",
      "notificationSettings.back": "Volver a notificaciones"
    },
    "common": {
      "notFound.help": "Ir a ayuda"
    }
  }
} as const;

describe("sentence-case product copy", () => {
  for (const [locale, namespaces] of Object.entries(expected)) {
    for (const [namespace, entries] of Object.entries(namespaces)) {
      it(`${locale}/${namespace} uses the reviewed sentence-case labels`, () => {
        const data = dictionary(locale, namespace);
        for (const [key, text] of Object.entries(entries)) expect(value(data, key), key).toBe(text);
      });
    }
  }

  it.each(["en", "ar", "fr", "de", "es"])("keeps required labels translated and proper names intact in %s", locale => {
    const data = dictionary(locale, "uptimeMonitor");
    for (const key of ["actions.checkNow", "actions.deleteMonitor", "actions.addChannel", "actions.addProvider", "quickAdd.submit", "quickAdd.button", "bulkAdd.button", "notificationSettings.title", "emailProviders.title", "notificationSettings.defaults.title", "notifications.fields.channelType", "notifications.fields.notifyOnRecovery", "detail.lastChecked", "detail.responseTime", "overview.stats.totalChecks", "tlsMonitoring.title", "detail.failureThreshold", "apiKeys.title"]) {
      expect(value(data, key), key).toEqual(expect.any(String));
      expect(String(value(data, key)).trim(), key).not.toBe("");
    }
    expect(value(data, "notifications.channelTypes.slack")).toBe("Slack");
  });
  it("preserves German noun capitals and technical acronyms", () => {
    const data = dictionary("de", "uptimeMonitor");
    expect(value(data, "actions.createMonitor")).toBe("Neuer Monitor");
    expect(value(data, "tlsMonitoring.title")).toBe("TLS-Zertifikatsüberwachung");
    expect(value(dictionary("en", "uptimeMonitor"), "create.fields.method")).toBe("HTTP method");
  });
});
