import { defineConfig } from "vitest/config";

// Pure schema/helper tests need neither a database nor migration setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/schema/*.test.ts"],
    fileParallelism: false,
  },
});
