// 纯文字里的网址识别：omp 把 `Trace: http://127.0.0.1:3847/#/traces?s=…` 这类地址放在普通 text 节点里，没有 href。
// 只认 http(s)；结尾的标点和没有配对的右括号不算网址的一部分。

export interface LinkPiece {
  text: string;
  /** 只有网址片段有值。 */
  url?: string;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const PUNCT = ".,;:!?，。；：！？、）】》";
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** 去掉网址尾巴上的标点；右括号只在网址里没有与之配对的左括号时才去掉。 */
function trimUrl(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1]!;
    const open = CLOSERS[last];
    if (open !== undefined) {
      const opens = url.split(open).length - 1;
      const closes = url.split(last).length - 1;
      if (opens >= closes) break;
    } else if (!PUNCT.includes(last)) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** 把一段文字切成「普通文字 / 网址」片段；没有网址时返回 null（调用方按原样渲染）。 */
export function splitUrls(text: string): LinkPiece[] | null {
  if (!text.includes("://")) return null;
  const pieces: LinkPiece[] = [];
  let pos = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (!/^https?:\/\/[^/?#\s]+/i.test(url)) continue;
    const start = match.index;
    if (start > pos) pieces.push({ text: text.slice(pos, start) });
    pieces.push({ text: url, url });
    pos = start + url.length;
  }
  if (pieces.length === 0) return null;
  if (pos < text.length) pieces.push({ text: text.slice(pos) });
  return pieces;
}
