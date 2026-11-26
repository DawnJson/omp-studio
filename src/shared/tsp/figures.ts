// 回复里 ```svg 图的源码（纯函数）。omp 在 TSP 里把一段回复文字按 ```svg 围栏拆成"文字、图、文字……"几个兄弟节点：
// 文字是 `md` 节点（id `<前缀>/t<段号>`、`…/t<段号>.2`、`.4` …），图是 `image` 节点（role `omp.figure.svg`，
// id `<前缀>/svg:t<段号>.1~1`、`.3~1` …），图里只有 omp 按它自己的终端主题栅格化好的 PNG，没有 svg 源码
// （omp 19.2.1 实测，docs/architecture/conversation.md「svg 图」）。源码只在会话文件那条助手消息的原文里：
// 这里定一个两边都算得出的"签名"（这段文字被 svg 围栏切开后，围栏之间那几段文字），主进程按签名从会话文件找回源码，
// 渲染进程按签名去要。id 规则是 omp 自己的命名，不在 TSP 规范里：omp 改了就找不到，界面退回显示 omp 的 PNG。

/** 一段文字按 ```svg 围栏切开：围栏之间的文字（去掉首尾空白）和每个 svg 围栏里的源码，按出现顺序。 */
export interface FigureSplit {
  segments: string[];
  svgs: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

/**
 * 按行扫描围栏（CommonMark：``` 或 ~~~ 至少三个，结束符同一种字符且不短于开头）。只有信息串是 `svg` 的围栏算图；
 * 别的围栏（含里面写着 ```svg 的 markdown 示例）照普通文字留在段里。没闭合的 svg 围栏不算图（omp 也不画）。
 */
export function splitSvgFences(text: string): FigureSplit {
  const lines = text.split("\n");
  const segments: string[] = [];
  const svgs: string[] = [];
  let current: string[] = [];
  let open: { marker: string; svg: boolean; start: number; body: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    const match = FENCE.exec(line.replace(/\r$/, ""));
    if (open === null) {
      if (match === null) {
        current.push(line);
        continue;
      }
      const marker = match[1] ?? "";
      open = { marker, svg: (match[2] ?? "").toLowerCase() === "svg", start: index, body: [] };
      if (!open.svg) current.push(line);
      continue;
    }
    const closes =
      match !== null &&
      (match[2] ?? "") === "" &&
      (match[1] ?? "")[0] === open.marker[0] &&
      (match[1] ?? "").length >= open.marker.length;
    if (!closes) {
      if (open.svg) open.body.push(line);
      else current.push(line);
      continue;
    }
    if (open.svg) {
      segments.push(current.join("\n").trim());
      svgs.push(open.body.join("\n"));
      current = [];
    } else current.push(line);
    open = null;
  }
  // 没闭合的 svg 围栏：原样算回文字。
  if (open?.svg) current.push(...lines.slice(open.start));
  segments.push(current.join("\n").trim());
  return { segments, svgs };
}

/** 文字段 → 签名：段之间用 U+0000 连起来，去掉末尾的空段（最后一张图后面没有文字时 omp 不出那个节点）。 */
export function figureSignature(segments: readonly string[]): string {
  const kept = [...segments];
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\u0000");
}

const FIGURE_ID = /^(.*\/)svg:(t\d+)\.(\d+)~\d+$/;

/** 图节点 id → 它所在的那段文字（id 前缀 + `t<段号>`）和它是这段文字里第几张图（从 0 起）；认不出为 null。 */
export function parseFigureId(id: string): { prefix: string; block: string; ordinal: number } | null {
  const match = FIGURE_ID.exec(id);
  if (match === null) return null;
  const position = Number(match[3]);
  if (position % 2 !== 1) return null;
  return { prefix: match[1] ?? "", block: match[2] ?? "", ordinal: (position - 1) / 2 };
}

/**
 * 文档这一侧的签名：图节点的兄弟里同一段文字的 md 节点（`t0` 是第 0 段，`t0.2` 第 1 段……），按位置排好；缺的位置是空段
 * （回复以图开头时 omp 不出第 0 段）。`siblingText(id)` 给出兄弟 md 节点的文字，没有这个节点为 null。
 */
export function documentFigureSignature(
  figure: { prefix: string; block: string },
  siblingIds: readonly string[],
  siblingText: (id: string) => string | null,
): string {
  const head = `${figure.prefix}${figure.block}`;
  let last = 0;
  for (const id of siblingIds) {
    const asFigure = parseFigureId(id);
    if (asFigure !== null) {
      if (asFigure.prefix === figure.prefix && asFigure.block === figure.block)
        last = Math.max(last, asFigure.ordinal * 2 + 1);
      continue;
    }
    if (!id.startsWith(`${head}.`)) continue;
    const position = Number(id.slice(head.length + 1));
    if (Number.isInteger(position)) last = Math.max(last, position);
  }
  const segments: string[] = [];
  for (let position = 0; position <= last + 1; position += 2) {
    const id = position === 0 ? head : `${head}.${position}`;
    segments.push((siblingText(id) ?? "").trim());
  }
  return figureSignature(segments);
}
