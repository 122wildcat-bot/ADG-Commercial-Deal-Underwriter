import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Override vite.config's `root: client/` so vitest discovers shared/ tests.
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
});
