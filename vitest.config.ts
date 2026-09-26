import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests run on the server anyway.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.setup-db.ts"],
    env: {
      ENGINEX_MODE: "mock",
      DATABASE_URL: "postgres://montage:montage@localhost:5432/montage_test",
      REDIS_URL: "redis://localhost:6379/1",
    },
  },
});
