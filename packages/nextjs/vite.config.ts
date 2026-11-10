import { isAbsolute } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: { index: "src/index.ts", server: "src/server.ts" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: (id) => !id.startsWith(".") && !isAbsolute(id) && !id.startsWith("\0"),
      output: {
        banner: (chunk) => (chunk.isEntry && chunk.name === "index" ? '"use client";' : ""),
      },
    },
  },
});
