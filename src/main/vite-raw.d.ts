// Vite 的 `?raw` 导入：文件内容作为字符串打进包里（主进程用它带上 CHANGELOG.md）。
declare module "*?raw" {
  const content: string;
  export default content;
}
