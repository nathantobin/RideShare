import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative so the same build works at a domain root and at
  // https://<user>.github.io/RideShare/ without a second config.
  base: "./",
  build: { outDir: "dist", sourcemap: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
