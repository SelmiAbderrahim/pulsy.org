import { describe, expect, it } from "vitest";
import { parseRecipients } from "./recipients";
describe("notification recipient drafts", () => {
 it("normalizes domains, deduplicates exact destinations and preserves local-part case", () => {
  expect(parseRecipients(" Alice@EXAMPLE.COM, Alice@example.com\n alice@example.com ")).toEqual({ recipients: ["Alice@example.com", "alice@example.com"], invalid: [] });
 });
 it("reports every invalid address without silently dropping it", () => {
  expect(parseRecipients("valid@example.invalid, wrong, a@, ")).toEqual({ recipients: ["valid@example.invalid", "wrong", "a@"], invalid: ["wrong", "a@"] });
  expect(parseRecipients(" ,\n ")).toEqual({ recipients: [], invalid: [] });
 });
});
