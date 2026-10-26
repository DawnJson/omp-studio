/// <reference types="vite/types/import-meta.d.ts" />
// `import.meta.glob`（内置插件的扩展文件整目录打进主进程 bundle，见 client-accounts/deploy.ts）。
// Vite 的 `?raw` 导入：文件内容作为字符串打进包里（主进程用它带上 CHANGELOG.md）。
declare module "*?raw" {
  const content: string;
  export default content;
}
