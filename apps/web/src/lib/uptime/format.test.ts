import { formattingLocale } from "@/lib/formatting-locale";
import { describe, expect, it } from "vitest";
import type { UptimeMonitor } from "@/types/uptime";
import {
	compareMonitors,
	formatLatencyReason,
	measuredLatency,
	formatRelativeTime,
	responseTimeTone,
} from "./format";

function monitor(overrides: Partial<UptimeMonitor>): UptimeMonitor {
	return {
		uptimeMonitorId: "id",
		name: "Monitor",
		url: "https://example.com",
		method: "GET",
		expectedStatus: 200,
		timeout: 10000,
		interval: 300,
		active: true,
		status: "up",
		httpStatus: null,
		responseTime: null,
		lastCheckedAt: null,
		nextCheckAt: null,
		tlsExpiresAt: null,
		tlsExpiresInDays: null,
		consecutiveFailures: 0,
		failureThreshold: 3,
		uptimePercentage: null,
		tags: [],
		isPublic: false,
		statusPageTitle: null,
		statusPageDescription: null,
		userId: "user",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} as UptimeMonitor;
}

function sortIds(
	monitors: UptimeMonitor[],
	sort?: Parameters<typeof compareMonitors>[2],
	dir?: Parameters<typeof compareMonitors>[3],
): string[] {
	return [...monitors]
		.sort((a, b) => compareMonitors(a, b, sort, dir))
		.map((m) => m.uptimeMonitorId);
}

describe("compareMonitors()", () => {
	it("default sort pins worst health to the top, tie-broken by name", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "up", status: "up", name: "b" }),
			monitor({ uptimeMonitorId: "pending", status: "pending", name: "a" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "z" }),
			monitor({ uptimeMonitorId: "degraded", status: "degraded", name: "m" }),
		];
		expect(sortIds(monitors)).toEqual(["down", "degraded", "pending", "up"]);
	});

	it("default sort tie-breaks equal statuses by name", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "2", status: "up", name: "Beta" }),
			monitor({ uptimeMonitorId: "1", status: "up", name: "Alpha" }),
		];
		expect(sortIds(monitors)).toEqual(["1", "2"]);
	});

	it("treats unknown statuses as the pending tier", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "unknown", status: "mystery" as never, name: "a" }),
			monitor({ uptimeMonitorId: "pending", status: "pending", name: "b" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "c" }),
		];
		// unknown & pending share rank 2 → ordered by name (a before b); down first.
		expect(sortIds(monitors)).toEqual(["down", "unknown", "pending"]);
	});

	it("sorts by name honoring direction", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "b", name: "Beta" }),
			monitor({ uptimeMonitorId: "a", name: "Alpha" }),
		];
		expect(sortIds(monitors, "name", "asc")).toEqual(["a", "b"]);
		expect(sortIds(monitors, "name", "desc")).toEqual(["b", "a"]);
	});

	it("defaults direction to asc when omitted", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "b", name: "Beta" }),
			monitor({ uptimeMonitorId: "a", name: "Alpha" }),
		];
		expect(sortIds(monitors, "name")).toEqual(["a", "b"]);
	});

	it("sorts by status column honoring direction", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "up", status: "up", name: "a" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "b" }),
		];
		expect(sortIds(monitors, "status", "asc")).toEqual(["down", "up"]);
		expect(sortIds(monitors, "status", "desc")).toEqual(["up", "down"]);
	});

	it("sorts by response time, nulls last in both directions", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "slow", responseTime: 900 }),
			monitor({ uptimeMonitorId: "none", responseTime: null }),
			monitor({ uptimeMonitorId: "fast", responseTime: 20 }),
		];
		expect(sortIds(monitors, "response", "asc")).toEqual(["fast", "slow", "none"]);
		expect(sortIds(monitors, "response", "desc")).toEqual(["slow", "fast", "none"]);
	});

	it("keeps both-null response comparisons stable", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "1", responseTime: null }),
			monitor({ uptimeMonitorId: "2", responseTime: null }),
		];
		expect(sortIds(monitors, "response", "asc")).toEqual(["1", "2"]);
	});

	it("sorts by uptime, nulls last in both directions", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "mid", uptimePercentage: 95 }),
			monitor({ uptimeMonitorId: "none", uptimePercentage: null }),
			monitor({ uptimeMonitorId: "high", uptimePercentage: 99.9 }),
		];
		expect(sortIds(monitors, "uptime", "asc")).toEqual(["mid", "high", "none"]);
		expect(sortIds(monitors, "uptime", "desc")).toEqual(["high", "mid", "none"]);
	});
});

describe("responseTimeTone()", () => {
	it("returns null for no measurement", () => {
		expect(responseTimeTone(null)).toBeNull();
	});
	it("buckets by threshold", () => {
		expect(responseTimeTone(0)).toBe("good");
		expect(responseTimeTone(299)).toBe("good");
		expect(responseTimeTone(300)).toBe("warn");
		expect(responseTimeTone(999)).toBe("warn");
		expect(responseTimeTone(1000)).toBe("bad");
		expect(responseTimeTone(5000)).toBe("bad");
	});
});

describe("formatRelativeTime()", () => {
	const now = new Date("2026-07-01T12:00:00.000Z").getTime();

	it("returns em dash for null or invalid input", () => {
		expect(formatRelativeTime(null, "en", now)).toBe("—");
		expect(formatRelativeTime("not-a-date", "en", now)).toBe("—");
	});

	it("formats seconds, minutes, hours, and days ago", () => {
		expect(formatRelativeTime("2026-07-01T11:59:55.000Z", "en", now)).toContain(
			"second",
		);
		expect(formatRelativeTime("2026-07-01T11:55:00.000Z", "en", now)).toContain(
			"minute",
		);
		expect(formatRelativeTime("2026-07-01T09:00:00.000Z", "en", now)).toContain(
			"hour",
		);
		expect(formatRelativeTime("2026-06-28T12:00:00.000Z", "en", now)).toContain(
			"day",
		);
	});

	it("is locale aware", () => {
		// French for "minute(s)" contains "minute" too; assert it differs from en 'ago'.
		const fr = formatRelativeTime("2026-07-01T11:55:00.000Z", "fr", now);
		expect(fr).not.toContain("ago");
	});
});

describe("compareMonitors() with mixed monitor types", () => {
	const mixed = () => [
		monitor({ uptimeMonitorId: "http", monitorType: "http", name: "a", responseTime: 200, uptimePercentage: 99 }),
		// Heartbeats and brand-new monitors have no response time; unknown stays last, never 0 ms.
		monitor({ uptimeMonitorId: "heartbeat", monitorType: "heartbeat", name: "b", responseTime: null, uptimePercentage: null }),
		monitor({ uptimeMonitorId: "dns", monitorType: "dns", name: "c", responseTime: 20, uptimePercentage: 100 }),
	];
	it("keeps unsupported response times last in both directions", () => {
		expect(sortIds(mixed(), "response", "asc")).toEqual(["dns", "http", "heartbeat"]);
		expect(sortIds(mixed(), "response", "desc")).toEqual(["http", "dns", "heartbeat"]);
	});
	it("sorts check success numerically and keeps unknown last in both directions", () => {
		expect(sortIds(mixed(), "uptime", "asc")).toEqual(["http", "dns", "heartbeat"]);
		expect(sortIds(mixed(), "uptime", "desc")).toEqual(["dns", "http", "heartbeat"]);
	});
});


describe("uptime sort stability", () => {
  it.each(["asc", "desc"] as const)("keeps unknown last and ties deterministic in %s", dir => {
    const rows=[monitor({uptimeMonitorId:"z", name:"Zero",uptimePercentage:0}),
      monitor({uptimeMonitorId:"b",name:"Tie",uptimePercentage:50}),
      monitor({uptimeMonitorId:"a",name:"Tie",uptimePercentage:50}),
      monitor({uptimeMonitorId:"u",name:"Unknown",uptimePercentage:null})];
    const expected=dir==="asc"?["z","a","b","u"]:["a","b","z","u"];
    expect(sortIds(rows,"uptime",dir)).toEqual(expected);
    expect(sortIds([...rows].reverse(),"uptime",dir)).toEqual(expected);
  });
});


describe("latency cause presentation", () => {
  it("translates measured values and the historical threshold without interpreting other incident text", () => {
    const t = (key: string, options: { actual: string; threshold: string }) => `${key}: ${options.actual}/${options.threshold}`;
    expect(formatLatencyReason("Response time 700 ms exceeds 500 ms", t)).toBe("latency.cause: 700/500");
    expect(formatLatencyReason("Operator note: cache refresh", t)).toBe("Operator note: cache refresh");
    expect(formatLatencyReason(null, t)).toBe("—");
  });
});


describe("stored observation freshness", () => {
  it("keeps the inclusive boundary and excludes paused, new and overdue observations", async () => {
    const { isStaleObservation } = await import("./format");
    const now = Date.parse("2026-10-11T12:00:00Z");
    const monitor = { active: true, status: "up", interval: 30, timeout: 1_000, lastCheckedAt: new Date(now - 61_000).toISOString() } as UptimeMonitor;
    expect(isStaleObservation(monitor, now)).toBe(false);
    expect(isStaleObservation(monitor, now + 1)).toBe(true);
    expect(isStaleObservation({ ...monitor, active: false }, now + 1)).toBe(false);
    expect(isStaleObservation({ ...monitor, status: "pending" }, now + 1)).toBe(false);
    expect(isStaleObservation({ ...monitor, lastCheckedAt: new Date(now + 1).toISOString() }, now)).toBe(false);
    expect(isStaleObservation({ ...monitor, monitorType: "heartbeat", nextCheckAt: new Date(now - 10_001).toISOString() }, now)).toBe(true);
  });

  it("marks missed scheduled heartbeat evaluations stale independently of last ping", async () => {
    const { isStaleObservation } = await import("./format");
    const now = Date.parse("2026-10-11T12:00:00Z");
    const heartbeat = { active: true, status: "down", monitorType: "heartbeat", interval: 60, timeout: 1_000, lastCheckedAt: new Date(now - 18 * 3_600_000).toISOString(), nextCheckAt: null } as unknown as UptimeMonitor;
    // Down still evaluates on cadence; an 18-hour-old evaluation is stale.
    expect(isStaleObservation(heartbeat, now)).toBe(true);
    // A future deadline cannot conceal a stopped evaluator.
    expect(isStaleObservation({ ...heartbeat, status: "up", nextCheckAt: new Date(now + 60_000).toISOString() }, now)).toBe(true);
    expect(isStaleObservation({ ...heartbeat, lastCheckedAt: new Date(now - 30_000).toISOString() }, now)).toBe(false);
    // A deadline that passed more than 10 s ago without the evaluator recording it is.
    expect(isStaleObservation({ ...heartbeat, status: "up", nextCheckAt: new Date(now - 11_000).toISOString() }, now)).toBe(true);
  });
});

describe("shared interval plurals", () => {
  async function intervalTranslator(locale: string) {
    const { readFileSync } = await import("node:fs");
    const { default: i18next } = await import("i18next");
    const resource = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
    const instance = i18next.createInstance();
    await instance.init({ lng: locale, fallbackLng: false, defaultNS: "uptimeMonitor", resources: { [locale]: { uptimeMonitor: resource } }, interpolation: { escapeValue: false } });
    return { t: instance.t.bind(instance), resource };
  }

  it.each([
    ["en", "minute", "minutes"], ["ar", "دقيقة", "دقائق"],
    ["fr", "minute", "minutes"], ["de", "Minute", "Minuten"], ["es", "minuto", "minutos"],
  ])("formats one and five minutes with the %s plural family", async (locale, singular, plural) => {
    const { formatInterval } = await import("./format");
    const { t } = await intervalTranslator(locale!);
    const number = new Intl.NumberFormat(formattingLocale(locale));
    expect(formatInterval(60, t, locale)).toBe(`${number.format(1)} ${singular}`);
    expect(formatInterval(300, t, locale)).toBe(`${number.format(5)} ${plural}`);
  });

  it.each(["en", "ar", "fr", "de", "es"])("has every %s category for second/minute/hour/day intervals", async locale => {
    const { formatInterval } = await import("./format");
    const { t, resource } = await intervalTranslator(locale);
    for (const unit of ["second", "minute", "hour", "day"]) {
      for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
        expect(resource.intervals[`${unit}_${category}`]).toEqual(expect.any(String));
        expect(resource.intervals[`${unit}_${category}`]).toContain("{{formattedCount}}");
      }
    }
    for (const seconds of [0, 1, 2, 3, 11, 100, 60, 120, 300, 660, 6000, 3600, 86400]) {
      expect(formatInterval(seconds, t, locale)).not.toMatch(/intervals\.|\{\{/);
    }
  });

  it.each([[0, "ثانية"], [1, "ثانية"], [2, "ثانيتان"], [3, "ثوانٍ"], [11, "ثانية"], [100, "ثانية"]])("uses the Arabic seconds category for %i", async (seconds, noun) => {
    const { formatInterval } = await import("./format");
    const { t } = await intervalTranslator("ar");
    expect(formatInterval(seconds as number, t, "ar")).toBe(`${new Intl.NumberFormat(formattingLocale("ar")).format(seconds as number)} ${noun}`);
  });

  it("keeps fractional and mixed intervals exact, rather than rounding to another interval", async () => {
    const { formatInterval } = await import("./format");
    const { t } = await intervalTranslator("en");
    expect(formatInterval(90, t, "en")).toBe("90 seconds");
    expect(formatInterval(1.5, t, "en")).toBe("1.5 seconds");
    expect(formatInterval(3600, t, "en")).toBe("1 hour");
    expect(formatInterval(172800, t, "en")).toBe("2 days");
    expect(formatInterval(NaN, t, "en")).toBe("—");
    expect(formatInterval(-1, t, "en")).toBe("—");
  });

  it("uses the active i18next locale when existing callers omit locale", async () => {
    const { default: i18next } = await import("i18next");
    const { formatInterval } = await import("./format");
    const { t, resource } = await intervalTranslator("de");
    await i18next.init({ lng: "de", resources: { de: { uptimeMonitor: resource } } });
    expect(formatInterval(300, t)).toBe("5 Minuten");
  });
});

describe("measuredLatency() — failed checks never carry a latency", () => {
	it.each([
		["a down HTTP check without a response (time-to-failure)", { status: "down", httpStatus: null, responseTime: 4200 }, undefined, null],
		["the same row for an explicit http monitor", { status: "down", httpStatus: null, responseTime: 4200 }, "http", null],
		["a stored null", { status: "down", httpStatus: null, responseTime: null }, "http", null],
		["an up check", { status: "up", httpStatus: 200, responseTime: 120 }, "http", 120],
		["a measured zero", { status: "up", httpStatus: 200, responseTime: 0 }, "http", 0],
		["a down check that did get an HTTP response", { status: "down", httpStatus: 503, responseTime: 800 }, "http", 800],
		["a down TCP connect keeps its measurement type", { status: "down", httpStatus: null, responseTime: 30 }, "tcp", 30],
	] as const)("%s", (_name, check, type, expected) => {
		expect(measuredLatency(check, type)).toBe(expected);
	});

	it("never offers a green tone for a Down monitor, whatever its last timing", () => {
		expect(responseTimeTone(20, "down")).toBe("bad");
		expect(responseTimeTone(measuredLatency({ status: "down", httpStatus: null, responseTime: 20 }), "down")).toBe("bad");
	});
});
