import { z } from "zod";
import { timezoneSchema } from "./timezone";

const id = z.string().min(1).max(64);
const timezone = timezoneSchema;
const date = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const apiPublicComponents = z.object({ statusPageId: id, components: z.array(z.object({ componentId: id, name: z.string().trim().min(1).max(200), description: z.string().max(1000).default(""), group: z.string().trim().max(80).default("") }).strict()).refine(values => new Set(values.map(value => value.componentId)).size === values.length) }).strict();
export const apiAnnouncementDraft = z.object({ id: id.optional(), previousId: id.optional(), statusPageId: id, title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(6000), stage: z.enum(["investigating", "identified", "monitoring", "resolved"]), componentIds: z.array(id).min(1).refine(values => new Set(values).size === values.length), timezone: timezone.default("UTC"), maintenance: z.object({ id, startsAt: date, endsAt: date }).strict().optional() }).strict();
