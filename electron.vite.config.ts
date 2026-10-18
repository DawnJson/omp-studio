import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = import.meta.dirname;

export default defineConfig({
  main: {
    build: {
      outDir: path.join(root, "out", "main"),
      lib: { entry: path.join(root, "src", "main", "index.ts"), formats: ["es"] },
    },
  },
  preload: {
    build: {
      outDir: path.join(root, "out", "preload"),
      // 沙箱里的 preload 不支持 ESM，必须是 CJS。
      lib: { entry: path.join(root, "src", "preload", "index.ts"), formats: ["cjs"], fileName: () => "index.cjs" },
    },
  },
  renderer: {
    root: path.join(root, "src", "renderer"),
    plugins: [react()],
    build: {
      outDir: path.join(root, "out", "renderer"),
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, "src", "renderer", "index.html") },
    },
  },
});
