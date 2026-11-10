import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: { external: [/^modern-screenshot/] },
  },
});
