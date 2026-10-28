import { describe, expect, it } from "vitest";
import { getTranslator } from "./i18n";
import { withManualActionLimit } from "./manual-limit";

const t = getTranslator("en");
const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve; }); return { promise, open }; };

describe("withManualActionLimit", () => {
	it("allows three in flight per account, rejects the fourth, and frees a slot when one finishes", async () => {
		const hold = gate();
		const running = Array.from({ length: 3 }, () => withManualActionLimit("u1", t, () => hold.promise));
		await expect(withManualActionLimit("u1", t, async () => "x")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		expect(await withManualActionLimit("u2", t, async () => "other account")).toBe("other account");
		hold.open();
		await Promise.all(running);
		expect(await withManualActionLimit("u1", t, async () => "free again")).toBe("free again");
	});

	it("releases the slot when the work throws", async () => {
		for (let i = 0; i < 5; i++) await expect(withManualActionLimit("u3", t, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
		expect(await withManualActionLimit("u3", t, async () => "ok")).toBe("ok");
	});
});
