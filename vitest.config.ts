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
        resolve: { alias },
        test: { name: "nextjs", root: r("./packages/nextjs"), environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
      },
    ],
  },
});
