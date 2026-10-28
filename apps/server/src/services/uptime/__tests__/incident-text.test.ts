import { expect, it } from "vitest";
import { encrypt } from "../../../lib/crypto";
import { getTranslator } from "../../../lib/i18n";
import { redactIncidentText } from "../incident-text";
it("redacts numeric private JSON values before incident/publication text persistence", () => {
  const monitor = { requestCipher: encrypt(JSON.stringify({ headers: [], body: '{"pin":1234}', contentType: "application/json" })) };
  expect(redactIncidentText(monitor, "The private PIN is 1234.", getTranslator("en"))).toBe("The private PIN is [redacted].");
});
