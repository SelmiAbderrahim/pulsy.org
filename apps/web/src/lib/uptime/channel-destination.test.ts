import { expect, it } from "vitest";
import { channelDestination } from "./channel-destination";

it("uses only the OSS server-masked target even if a legacy object contains raw credentials", () => {
  const channel = { channelType: "webhook" as const, recipientAddresses: null, webhookUrlMasked: "hooks.example.com/•••", webhookUrl: "https://hooks.example.com/private-token?secret=credential" };
  expect(channelDestination(channel)).toBe("hooks.example.com/•••");
  expect(channelDestination({ ...channel, webhookUrlMasked: null })).toBe("");
});

it("renders email recipients instead of any webhook destination", () => {
  expect(channelDestination({ channelType: "email", recipientAddresses: ["ops@example.com", "backup@example.com"], webhookUrlMasked: "unused" })).toBe("ops@example.com, backup@example.com");
});
