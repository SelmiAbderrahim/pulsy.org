import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod validation schemas for the organization API surface.
//
// Kept separate from organization.ts (Drizzle table declarations) so the
// validation logic is unit-tested and coverage-gated.
// ---------------------------------------------------------------------------

export const organizationMemberRoleSchema = z.enum([
	"owner",
	"admin",
	"member",
]);

// Roles invitable through the API — owners are created implicitly when an org
// is created, never through the invite endpoint.
export const invitableMemberRoleSchema = z.enum(["admin", "member"]);

// Organization slugs are user-visible URL fragments: lowercase, hyphenated.
const organizationSlugSchema = z
	.string()
	.min(2)
	.max(64)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
		message:
			"Slug must be lowercase alphanumeric, may contain hyphens, no leading/trailing hyphen",
	});

export const apiCreateOrganization = z.object({
	name: z.string().trim().min(1).max(120),
	slug: organizationSlugSchema,
});

export const apiUpdateOrganization = z.object({
	organizationId: z.string().min(1),
	name: z.string().trim().min(1).max(120).optional(),
	slug: organizationSlugSchema.optional(),
});

export const apiInviteOrganizationMember = z.object({
	organizationId: z.string().min(1),
	email: z.string().email(),
	role: invitableMemberRoleSchema.default("member"),
});

export const apiUpdateOrganizationMemberRole = z.object({
	organizationId: z.string().min(1),
	memberId: z.string().min(1),
	role: invitableMemberRoleSchema,
});

export const apiRemoveOrganizationMember = z.object({
	organizationId: z.string().min(1),
	memberId: z.string().min(1),
});

export type OrganizationMemberRole = z.infer<typeof organizationMemberRoleSchema>;
export type InvitableMemberRole = z.infer<typeof invitableMemberRoleSchema>;
