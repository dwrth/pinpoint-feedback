import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const external = ["react", "react-dom", "react/jsx-runtime", "@pinpoint-feedback/core"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rolldownOptions: {
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: { banner: '"use client";' },
    },
  },
});
