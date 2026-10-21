// 输入框里的文件引用：渲染进程发给主进程的文字里，文件占位符是 `\uE000file:N\uE001`（N 从 1 起，对应 PromptInput.fileIds[N-1]）；
// 主进程把它换成 omp 的文件提及 `@"<路径>"`（omp 的 `@` 提及，路径带引号以容纳空格；和图片的提及同一种写法）。
export const fileSlot = (n: number): string => `\uE000file:${n}\uE001`;

const slotPattern = /\uE000file:(\d+)\uE001/g;

/** 把占位符换成 `@"路径"`；编号超出 paths 的占位符原样留着（不会出现，渲染进程只发有登记过的）。路径统一用正斜杠，omp 两种都认。 */
export function fillFileSlots(text: string, paths: readonly string[]): string {
  return text.replace(slotPattern, (whole, n: string) => {
    const file = paths[Number(n) - 1];
    return file === undefined ? whole : `@"${file.replaceAll("\\", "/")}"`;
  });
}
