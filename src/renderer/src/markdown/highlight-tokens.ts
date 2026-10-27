// 高亮结果的 token 类型，和新结果没到时的过渡拼法（纯函数，单测直接测；异步高亮在 highlight.ts）。

export interface HighlightToken {
  text: string;
  color?: string;
  italic: boolean;
  bold: boolean;
}

/**
 * 代码变了、新结果还没到时先拿上一次的结果顶着：没变的行照旧着色，上一次那行的后面追加出来的部分和新行是无色的纯文本。
 * omp 边生成边往代码节点里追加文字（eval / 写文件卡片），每追加一次都要重新高亮；直接退回纯文本的话，
 * 已经着色的字会在"无色 ↔ 着色"之间来回闪。Shiki 从前往后分词，前面没变的行后面追加文字也不会改它的 token，
 * 所以照旧用是对的；改了中间某行时后面的行可能暂时着错色，新结果一到就换掉。返回的行数、文字和 code 完全一致。
 */
export function carryHighlight(previous: readonly HighlightToken[][], code: string): HighlightToken[][] {
  return code.split("\n").map((line, index) => {
    const old = previous[index];
    if (old === undefined) return [{ text: line, italic: false, bold: false }];
    const oldText = old.map((token) => token.text).join("");
    if (line === oldText) return old;
    if (oldText !== "" && line.startsWith(oldText))
      return [...old, { text: line.slice(oldText.length), italic: false, bold: false }];
    return [{ text: line, italic: false, bold: false }];
  });
}
