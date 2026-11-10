import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node20",
    ssr: true,
    sourcemap: true,
    emptyOutDir: true,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: { external: [/^@notionhq\//, /^@pinpoint-feedback\//, /^node:/] },
  },
});
