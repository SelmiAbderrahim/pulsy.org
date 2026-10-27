import { beforeEach, expect, it, vi } from "vitest";
import { StatusCommunicationService } from "./statusCommunicationService";

const transport = vi.hoisted(() => ({ trpcQuery: vi.fn(), trpcMutation: vi.fn() }));
vi.mock("@/lib/api/trpc", () => transport);
beforeEach(() => vi.clearAllMocks());

it("sends a 100-component preview in a POST body without applying it", async () => {
  const components = Array.from({ length: 100 }, (_, index) => ({
    componentId: `component-${index}`, name: `Public component ${index}`,
    description: "Customer-facing description".repeat(10), group: "Production",
  }));
  transport.trpcMutation.mockResolvedValue({ revision: "preview" });
  expect(await StatusCommunicationService.componentsPreview("page", components)).toEqual({ revision: "preview" });
  expect(transport.trpcQuery).not.toHaveBeenCalled();
  expect(transport.trpcMutation).toHaveBeenCalledTimes(1);
  expect(transport.trpcMutation).toHaveBeenCalledWith("uptimeMonitor", "statusPage.communication.componentsPreviewPost", { statusPageId: "page", components });
});
