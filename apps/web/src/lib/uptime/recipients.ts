import { z } from "zod";
const address = z.email();
export function parseRecipients(value: string) {
  const values = value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
  const invalid = values.filter(item => !address.safeParse(item).success);
  // Preserve the local part: it may be case-sensitive. Normalize only domains.
  const recipients = [...new Set(values.map(item => item.replace(/@([^@]+)$/, (_, domain: string) => `@${domain.toLowerCase()}`)))];
  return { recipients, invalid };
}
