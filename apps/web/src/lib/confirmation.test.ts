import { expect, it, vi } from "vitest";
import { registerConfirmationHandler, requestConfirmation } from "./confirmation";
it("rejects a generic destructive title before opening the confirmation host", async () => {
  const handler = vi.fn().mockResolvedValue(true);
  const unregister = registerConfirmationHandler(handler);
  try {
    await expect(requestConfirmation("This removes the channel.", { title: "Confirm", action: "Confirm", destructive: true })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  } finally { unregister(); }
});
it("rejects a confirmation whose description repeats its title", async () => {
  const handler = vi.fn().mockResolvedValue(true);
  const unregister = registerConfirmationHandler(handler);
  try {
    await expect(requestConfirmation("Remove “view”? Monitors stay unchanged.", { title: " remove “view”?  monitors stay unchanged. " })).rejects.toThrow();
    await expect(requestConfirmation("Remove “view”? Monitors stay unchanged.", { title: "Remove view" })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  } finally { unregister(); }
});
