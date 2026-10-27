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

// KaTeX 的 @font-face 每个字体列了 woff2、woff、ttf 三种格式，Chromium 只取第一个支持的（woff2），
// 后两种从不请求，却会作为资源打进包里（约 0.8 MB）。转换 CSS 时删掉后两种，没被引用的字体文件就不会产出。
// katex 换了写法、没删干净就让构建失败，免得悄悄又把它们打进去。
const katexWoff2Only = {
  name: "omp-studio:katex-woff2-only",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.replaceAll("\\", "/").endsWith("/katex/dist/katex.min.css")) return null;
    const css = code.replace(/,url\([^)]+\.woff\) format\("woff"\),url\([^)]+\.ttf\) format\("truetype"\)/g, "");
    if (/\.(woff|ttf)\)/.test(css)) throw new Error("katex.min.css 的 @font-face 写法变了：woff / ttf 没删干净");
    return { code: css, map: null };
  },
};

export default defineConfig({
  main: {
    build: {
      outDir: path.join(root, "out", "main"),
      // 不用 lib：lib 模式下 `?modulePath` 的子构建（SQLite worker）拿到的是输出数组，electron-vite 6 读 `.output` 会崩。
      rolldownOptions: { input: path.join(root, "src", "main", "index.ts") },
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
    plugins: [react(), injectCsp, katexWoff2Only],
    // 高亮 worker 按需加载语言包（动态 import），iife 不支持拆包，只能用 ES 模块 worker。
    worker: { format: "es" },
    build: {
      outDir: path.join(root, "out", "renderer"),
      emptyOutDir: true,
      // 压缩同时作用于高亮 worker（Vite 按这个开关决定）。electron-vite 的渲染进程预设默认不压缩。
      minify: "oxc",
      // CSS 不压缩：lightningcss 把 animation-timeline 并进 animation 简写，Electron 44 的 Chromium 不认，
      // 滚动边缘渐隐（.ui-scroll-fade 的 scroll(self) 时间线）整个失效（2026-10-27 e2e 发现）。
      cssMinify: false,
    },
  },
});
