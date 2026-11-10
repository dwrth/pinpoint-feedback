import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const localesDir = fileURLToPath(new URL("./src/locales", import.meta.url));

/** Every file in src/locales becomes its own entry point: `@pinpoint-feedback/core/locales/<tag>`. */
const localeEntries = Object.fromEntries(
  readdirSync(localesDir)
    .filter((file) => /^[A-Za-z0-9-]+\.ts$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => [`locales/${file.slice(0, -3)}`, `src/locales/${file}`]),
);

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: { index: "src/index.ts", ...localeEntries },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [/^modern-screenshot/],
      output: { chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
