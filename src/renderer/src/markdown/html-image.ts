// 单独占一行的 `<img src="…" alt="…" width="…">`：当成 `![alt](src)` 的图片，其余原始 HTML 仍按 html:false 当文字。
// 只认整行、属性值都带引号；只取 src / alt / width，别的属性（onerror、style…）一律不用——token 是这里自己造的，
// 原文不进 DOM。src 和 `![](…)` 走同一套 normalizeLink / validateLink，javascript: 之类照样被拒，加载规则也和 `![](…)` 一样（render.ts）。
import type { MarkdownIt, StateBlock } from "markdown-it";

const imgLine = /^<img\b((?:\s+[a-z][a-z0-9-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>$/i;
const attribute = /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function readAttributes(list: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of list.matchAll(attribute)) {
    const name = match[1]!.toLowerCase();
    if (!found.has(name)) found.set(name, match[2] ?? match[3] ?? "");
  }
  return found;
}

function htmlImage(state: StateBlock, startLine: number, _endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const line = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!).trimEnd();
  const match = imgLine.exec(line);
  if (!match) return false;
  const attrs = readAttributes(match[1] ?? "");
  const src = attrs.get("src")?.trim() ?? "";
  if (src === "") return false;
  const href = state.md.normalizeLink(src);
  if (!state.md.validateLink(href)) return false;
  if (silent) return true;

  const width = attrs.get("width")?.trim() ?? "";
  const alt = attrs.get("alt") ?? "";
  const map: [number, number] = [startLine, startLine + 1];
  state.push("paragraph_open", "p", 1).map = map;
  const inline = state.push("inline", "", 0);
  inline.map = map;
  inline.content = "";
  const image = new state.Token("image", "img", 0);
  image.attrs = [
    ["src", href],
    ["alt", ""],
  ];
  if (/^\d{1,4}$/.test(width)) image.attrSet("width", width);
  image.content = alt;
  inline.children = [image];
  state.push("paragraph_close", "p", -1);
  state.line = startLine + 1;
  return true;
}

export function htmlImagePlugin(md: MarkdownIt): void {
  md.block.ruler.before("paragraph", "html_image", htmlImage, { alt: ["paragraph"] });
}
