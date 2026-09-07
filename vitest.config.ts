import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure core is unit-tested: nothing under src/core touches a
    // Zotero or DOM global, so the whole suite runs headless in Node.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
