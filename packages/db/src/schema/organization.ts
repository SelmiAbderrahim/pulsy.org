// ---------------------------------------------------------------------------
// Organizations — optional grouping of Pulsy accounts.
//
// Monitors and every other uptime row stay `userId`-scoped; an organization
// only groups accounts (owner + members) so a team can share an operator view.
// Self-hosted Pulsy has no plans and no seat caps, so membership is unlimited.
// ---------------------------------------------------------------------------

import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";

export const organizationMemberRoleEnum = pgEnum("organizationMemberRole", [
	"owner",
	"admin",
	"member",
]);

/**
 * Organization — groups multiple users. Slugs are unique platform-wide.
 */
export const organization = pgTable(
	"organization",
	{
		organizationId: text("organizationId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		ownerUserId: text("ownerUserId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [index("organization_owner_idx").on(table.ownerUserId)],
);

/**
 * Organization member — links a user to an organization with a role.
 * Owners always have a row with role="owner". Deleting either side cascades.
 */
export const organizationMember = pgTable(
	"organization_member",
	{
		memberId: text("memberId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.organizationId, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: organizationMemberRoleEnum("role").notNull().default("member"),
		invitedAt: text("invitedAt"),
		joinedAt: text("joinedAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// A user appears at most once per organization.
		uniqueIndex("organization_member_org_user_uq").on(
			table.organizationId,
			table.userId,
		),
		index("organization_member_user_idx").on(table.userId),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const organizationRelations = relations(organization, ({ many, one }) => ({
	owner: one(user, {
		fields: [organization.ownerUserId],
		references: [user.id],
	}),
	members: many(organizationMember),
}));

export const organizationMemberRelations = relations(
	organizationMember,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationMember.organizationId],
			references: [organization.organizationId],
		}),
		user: one(user, {
			fields: [organizationMember.userId],
			references: [user.id],
		}),
	}),
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type OrganizationMember = typeof organizationMember.$inferSelect;
export type NewOrganizationMember = typeof organizationMember.$inferInsert;
