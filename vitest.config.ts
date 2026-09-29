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
    // One shared test DB: sweep() in lifecycle and staged tests touches every job, so files run one at a time.
    fileParallelism: false,
    env: {
      ENGINEX_MODE: "mock",
      DATABASE_URL: `postgres://montage:montage@localhost:5432/${process.env.TEST_DB ?? "montage_test"}`,
      REDIS_URL: "redis://localhost:6379/1",
    },
  },
});
