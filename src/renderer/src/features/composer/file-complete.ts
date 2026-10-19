// `@` 文件引用补全（spec 4.14 FileMenu）：光标前面的词以 `@` 开头时，向主进程要项目文件列表（use-file-menu.ts）；
// Tab/Enter 把它替换成 `@相对路径 `，omp 自己会把 `@路径` 展开成文件内容。这里只放纯函数。

export interface AtReference {
  /** `@` 在文本里的下标。 */
  start: number;
  /** `@` 后面、光标前面已经敲的字符。 */
  query: string;
}

/** 光标前的词是 `@xxx`（`@` 在文本开头或空白之后）时返回它；邮箱 `a@b` 不算。 */
export function atReference(text: string, caret: number): AtReference | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** 把 `@query` 换成 `@path `（后面补一个空格，方便接着写）；返回新文本和新光标位置。 */
export function applyFileCompletion(
  text: string,
  caret: number,
  reference: AtReference,
  file: string,
): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^[^\s@]*/, "");
  // 后面已经是空白就不再补空格，光标越过它。
  const spaced = /^\s/.test(after);
  const inserted = spaced ? `@${file}` : `@${file} `;
  return {
    text: text.slice(0, reference.start) + inserted + after,
    caret: reference.start + inserted.length + (spaced ? 1 : 0),
  };
}
