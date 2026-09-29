import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside the Workers runtime, where HTMLRewriter is built in, as in production.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-08-22" } })],
  test: { include: ["test/**/*.test.ts"] },
});
