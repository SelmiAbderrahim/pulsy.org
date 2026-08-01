import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
	createCallerFactory,
	protectedProcedure,
	publicProcedure,
	router,
} from "../trpc";
import { buildContext } from "../../../test/trpc-caller";

// ---------------------------------------------------------------------------
// Unit test for the `enforceAuthed` middleware behind protectedProcedure.
// A tiny throwaway router exercises both the public and protected paths so we
// don't depend on the shape of the real app router.
// ---------------------------------------------------------------------------

const probeRouter = router({
	openPing: publicProcedure.query(() => "pong"),
	securePing: protectedProcedure.query(({ ctx }) => ctx.user.id),
});

const createCaller = createCallerFactory(probeRouter);

describe("publicProcedure", () => {
	it("resolves without a session", async () => {
		const caller = createCaller(buildContext());
		await expect(caller.openPing()).resolves.toBe("pong");
	});

	it("resolves even when a session IS present", async () => {
		const caller = createCaller(
			buildContext({
				user: { id: "u1" } as never,
				session: { id: "s1" } as never,
			}),
		);
		await expect(caller.openPing()).resolves.toBe("pong");
	});
});

describe("protectedProcedure / enforceAuthed", () => {
	it("throws UNAUTHORIZED when both user and session are null", async () => {
		const caller = createCaller(buildContext());
		await expect(caller.securePing()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("throws UNAUTHORIZED when the user is present but the session is null", async () => {
		const caller = createCaller(
			buildContext({ user: { id: "u1" } as never, session: null }),
		);
		await expect(caller.securePing()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("throws UNAUTHORIZED when the session is present but the user is null", async () => {
		const caller = createCaller(
			buildContext({ user: null, session: { id: "s1" } as never }),
		);
		await expect(caller.securePing()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("uses the translated unauthorized message", async () => {
		const caller = createCaller(buildContext({ language: "fr" }));
		await expect(caller.securePing()).rejects.toMatchObject({
			message: "Vous devez être connecté pour faire cela",
		});
	});

	it("passes through and narrows ctx.user when authenticated", async () => {
		const caller = createCaller(
			buildContext({
				user: { id: "user-123" } as never,
				session: { id: "sess-1" } as never,
			}),
		);
		await expect(caller.securePing()).resolves.toBe("user-123");
	});

	it("surfaces a TRPCError instance (not a plain Error)", async () => {
		const caller = createCaller(buildContext());
		await caller.securePing().catch((err) => {
			expect(err).toBeInstanceOf(TRPCError);
		});
	});
});
