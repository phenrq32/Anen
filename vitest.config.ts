import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // O mesmo atalho da app (apps/web/tsconfig.json), para testar módulos do servidor que o usam.
    alias: { "@/": fileURLToPath(new URL("./apps/web/src/", import.meta.url)) },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
