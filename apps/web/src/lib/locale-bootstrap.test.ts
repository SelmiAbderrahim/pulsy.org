import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = readFileSync(resolve(process.cwd(), "public/locale-bootstrap.js"), "utf8");

describe("locale before first application paint", () => {
	beforeEach(() => {
		localStorage.clear();
		history.replaceState({}, "", "/login");
		document.documentElement.lang = "en";
		document.documentElement.dir = "ltr";
		vi.restoreAllMocks();
		document.getElementById("pulsy-private-titles")?.remove();
	});
	it.each(["en", "ar", "fr", "de", "es"])("resolves %s before resources load", language => {
		localStorage.setItem("i18nextLng", language);
		window.eval(bootstrap);
		expect(document.documentElement.lang).toBe(language);
		expect(document.documentElement.dir).toBe(language === "ar" ? "rtl" : "ltr");
		expect(document.documentElement.hasAttribute("data-locale-pending")).toBe(true);
		expect(document.title).toBe("Pulsy");
	});
	it("honors a supported query over the stored preference and normalizes regions", () => {
		localStorage.setItem("i18nextLng", "de");
		history.replaceState({}, "", "/login?lng=ar-EG");
		window.eval(bootstrap);
		expect(document.documentElement.lang).toBe("ar");
	});
	it("ignores an unsupported query without losing a valid preference", () => {
		localStorage.setItem("i18nextLng", "fr");
		history.replaceState({}, "", "/?lng=unsupported");
		window.eval(bootstrap);
		expect(document.documentElement.lang).toBe("fr");
	});
	it("works when storage is unavailable", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
		history.replaceState({}, "", "/?lng=es");
		expect(() => window.eval(bootstrap)).not.toThrow();
		expect(document.documentElement.lang).toBe("es");
	});

});
