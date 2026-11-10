import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  "@pinpoint-feedback/core": r("./packages/core/src/index.ts"),
  "@pinpoint-feedback/server": r("./packages/server/src/index.ts"),
  "@pinpoint-feedback/react": r("./packages/react/src/index.ts"),
  "@pinpoint-feedback/nextjs/server": r("./packages/nextjs/src/server.ts"),
  "@pinpoint-feedback/nextjs": r("./packages/nextjs/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "packages/*/src/**/*.d.ts",
        "packages/*/src/index.ts",
        "packages/core/src/types.ts",
        "packages/core/src/interfaces.ts",
        "packages/core/src/locales/**",
        "packages/react/src/types.ts",
      ],
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
    projects: [
      {
        resolve: { alias },
        test: { name: "core", root: r("./packages/core"), environment: "happy-dom", include: ["test/**/*.test.ts"] },
      },
      {
        resolve: { alias },
        test: { name: "server", root: r("./packages/server"), environment: "node", include: ["test/**/*.test.ts"] },
      },
      {
        resolve: { alias },
        test: { name: "react", root: r("./packages/react"), environment: "happy-dom", include: ["test/**/*.test.{ts,tsx}"] },
      },
      {
        test: { name: "scripts", root: r("./scripts"), environment: "node", include: ["**/*.test.mjs"] },
      },
      {
        resolve: { alias },
        test: { name: "nextjs", root: r("./packages/nextjs"), environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
      },
    ],
  },
});
