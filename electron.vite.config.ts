import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = import.meta.dirname;

// 严格 CSP：无内联脚本、无 eval、不从网络加载。只在构建时注入：开发服务器的 Fast Refresh 需要内联脚本。
// style-src 保留 'unsafe-inline'：只开放样式，脚本仍然只认同源文件。
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const injectCsp = {
  name: "omp-studio:csp",
  apply: "build" as const,
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
      injectTo: "head-prepend" as const,
    },
  ],
};

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
    plugins: [react(), injectCsp],
    build: {
      outDir: path.join(root, "out", "renderer"),
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, "src", "renderer", "index.html") },
    },
  },
});
