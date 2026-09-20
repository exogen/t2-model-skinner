import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^fabric$/, replacement: "fabric/node" },
      {
        find: "@config/models.json",
        replacement: fileURLToPath(new URL("./models.json", import.meta.url)),
      },
    ],
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,js,jsx,mjs}"],
    setupFiles: ["./vitest.setup.mjs"],
    pool: "forks",
  },
});
