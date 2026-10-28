import { db, user, uptimeMonitorView, apiSaveMonitorView } from "@pulsy/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";

const localizedViewProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.monitorViewInvalid"), cause: result.error.cause });
  return result;
});
const idInput = z.object({ id: z.string().min(1).max(64) }).strict();
export const monitorViewsRouter = router({
  initial: protectedProcedure.input(z.object({id:z.string().min(1).max(64).optional()}).strict()).query(async ({ctx,input}) =>
    (await db.select().from(uptimeMonitorView).where(and(eq(uptimeMonitorView.userId,ctx.user.id),input.id ? eq(uptimeMonitorView.id,input.id) : eq(uptimeMonitorView.isDefault,true))).limit(1))[0] ?? null),
  list: protectedProcedure.query(({ ctx }) => db.select().from(uptimeMonitorView).where(eq(uptimeMonitorView.userId, ctx.user.id)).orderBy(desc(uptimeMonitorView.pinned), asc(uptimeMonitorView.name), asc(uptimeMonitorView.id)).limit(200)),
  save: localizedViewProcedure.input(apiSaveMonitorView).mutation(({ ctx, input }) => db.transaction(async tx => {
    // The owner lock makes simultaneous default changes and safety limits atomic.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
    const owned = and(eq(uptimeMonitorView.userId, ctx.user.id), ...(input.id ? [eq(uptimeMonitorView.id, input.id)] : []));
    const [existing] = input.id ? await tx.select().from(uptimeMonitorView).where(owned).limit(1) : [];
    if (input.id && !existing) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "view" }) });
    if (!existing) {
      // Technical ceiling: 200 personal views per account until paging is added.
      const count = await tx.select({ id: uptimeMonitorView.id }).from(uptimeMonitorView).where(eq(uptimeMonitorView.userId, ctx.user.id)).limit(200);
      if (count.length >= 200) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.monitorViewLimit") });
    }
    if (input.isDefault) await tx.update(uptimeMonitorView).set({ isDefault: false }).where(and(eq(uptimeMonitorView.userId, ctx.user.id), eq(uptimeMonitorView.isDefault, true)));
    const values = { name: input.name, filters: input.filters, updatedAt: new Date().toISOString(),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) };
    const [saved] = existing ? await tx.update(uptimeMonitorView).set(values).where(owned).returning()
      : await tx.insert(uptimeMonitorView).values({ userId: ctx.user.id, ...values }).returning();
    return saved!;
  })),
  remove: localizedViewProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [removed] = await db.delete(uptimeMonitorView).where(and(eq(uptimeMonitorView.userId, ctx.user.id), eq(uptimeMonitorView.id, input.id))).returning({ id: uptimeMonitorView.id });
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "view" }) });
    return removed;
  }),
});
