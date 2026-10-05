import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The parser runs in any JavaScript runtime, so its tests run in the Workers runtime and in Node.
// `cleanHtml` builds on HTMLRewriter, which only the Workers runtime has.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({ miniflare: { compatibilityDate: "2026-08-22" } }),
        ],
        test: { include: ["test/**/*.test.ts"], name: "workers" },
      },
      {
        test: {
          environment: "node",
          exclude: ["test/clean.test.ts"],
          include: ["test/**/*.test.ts"],
          name: "node",
        },
      },
    ],
  },
});
