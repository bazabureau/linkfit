import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["./tests/setup/globalSetup.ts"],
    setupFiles: ["./tests/setup/perSuite.ts"],
    pool: "forks",
    forks: {
      singleFork: true,
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI ? { junit: "./coverage/junit.xml" } : undefined,
    coverage: {
      // Coverage is opt-in via `npm test -- --coverage` so local TDD runs
      // stay fast. CI wires `--coverage` explicitly when it wants the
      // json-summary written.
      provider: "v8",
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      // Pin the surface we care about — tests, generated SQL, and the
      // entrypoint are pulled in by includes anyway, but excluding them
      // makes the percentage line up with "actual product code".
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/index.ts",
      ],
    },
  },
});
