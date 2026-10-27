// ANSI 文本 → 行 / 片段（纯函数，ansi 和 rows 节点用）。
// 支持 SGR（16 色、256 色、真彩色、粗体/暗淡/斜体/下划线/反显/删除线）、OSC 8 超链接、\r 覆盖本行、\b 退格、\t 制表、
// CSI K（擦除行）；其它控制序列丢弃。颜色 0–15 给 CSS 变量（tsp.css 里映射到 tokens.css），其余是程序给的原始色值。

export interface AnsiRun {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
  href?: string;
}

interface Pen {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
}

interface Cell {
  ch: string;
  pen: Pen;
  href: string | undefined;
}

const CUBE = [0, 95, 135, 175, 215, 255];

function paletteColor(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 16) return `var(--tsp-ansi-${n})`;
  if (n < 232) {
    const i = n - 16;
    return `rgb(${CUBE[Math.floor(i / 36)]}, ${CUBE[Math.floor(i / 6) % 6]}, ${CUBE[i % 6]})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

function setColor(pen: Pen, key: "fg" | "bg", color: string | undefined): void {
  if (color === undefined) delete pen[key];
  else pen[key] = color;
}

/** 应用一条 SGR 参数列表。 */
function applySgr(pen: Pen, params: number[]): Pen {
  let next: Pen = { ...pen };
  for (let i = 0; i < params.length; i += 1) {
    const p = params[i]!;
    if (p === 0) next = {};
    else if (p === 1) next.bold = true;
    else if (p === 2) next.dim = true;
    else if (p === 3) next.italic = true;
    else if (p === 4) next.underline = true;
    else if (p === 7) next.inverse = true;
    else if (p === 9) next.strike = true;
    else if (p === 22) {
      next.bold = false;
      next.dim = false;
    } else if (p === 23) next.italic = false;
    else if (p === 24) next.underline = false;
    else if (p === 27) next.inverse = false;
    else if (p === 29) next.strike = false;
    else if (p >= 30 && p <= 37) setColor(next, "fg", paletteColor(p - 30));
    else if (p === 39) delete next.fg;
    else if (p >= 40 && p <= 47) setColor(next, "bg", paletteColor(p - 40));
    else if (p === 49) delete next.bg;
    else if (p >= 90 && p <= 97) setColor(next, "fg", paletteColor(p - 90 + 8));
    else if (p >= 100 && p <= 107) setColor(next, "bg", paletteColor(p - 100 + 8));
    else if (p === 38 || p === 48) {
      const mode = params[i + 1];
      let color: string | undefined;
      if (mode === 5) {
        color = paletteColor(params[i + 2] ?? -1);
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [params[i + 2], params[i + 3], params[i + 4]];
        if (r !== undefined && g !== undefined && b !== undefined) color = `rgb(${r}, ${g}, ${b})`;
        i += 4;
      }
      if (p === 38) {
        if (color) next.fg = color;
      } else if (color) next.bg = color;
    }
  }
  return next;
}

function samePen(a: Pen, b: Pen): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !a.bold === !b.bold &&
    !a.dim === !b.dim &&
    !a.italic === !b.italic &&
    !a.underline === !b.underline &&
    !a.strike === !b.strike &&
    !a.inverse === !b.inverse
  );
}

function runOf(text: string, pen: Pen, href: string | undefined): AnsiRun {
  const run: AnsiRun = { text };
  if (pen.fg) run.fg = pen.fg;
  if (pen.bg) run.bg = pen.bg;
  if (pen.bold) run.bold = true;
  if (pen.dim) run.dim = true;
  if (pen.italic) run.italic = true;
  if (pen.underline) run.underline = true;
  if (pen.strike) run.strike = true;
  if (pen.inverse) run.inverse = true;
  if (href !== undefined) run.href = href;
  return run;
}

function toRuns(cells: readonly Cell[]): AnsiRun[] {
  const runs: AnsiRun[] = [];
  let text = "";
  let pen: Pen = {};
  let href: string | undefined;
  for (const cell of cells) {
    if (text !== "" && (!samePen(pen, cell.pen) || href !== cell.href)) {
      runs.push(runOf(text, pen, href));
      text = "";
    }
    if (text === "") {
      pen = cell.pen;
      href = cell.href;
    }
    text += cell.ch;
  }
  if (text !== "") runs.push(runOf(text, pen, href));
  return runs;
}

// ESC [ params final | ESC ] … (BEL | ESC \) | ESC 其它单字符
// eslint-disable-next-line no-control-regex
const ESCAPE = /\u001b(?:\[([0-9;:?]*)([@-~])|\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|[@-Z\\-_])/y;

/** 某一行开头时的解析状态：从这里接着解析，结果和从头解析一样。 */
interface LineStart {
  pos: number;
  line: number;
  pen: Pen;
  href: string | undefined;
}

/** 一次解析的结果；输出继续追加时交给 parseAnsiStream 复用已经结束的行（同一个数组对象）。 */
export interface AnsiParse {
  source: string;
  lines: AnsiRun[][];
  /** 续解析的起点：最后一行的行首；有可能被后续文字改写含义的 OSC（还没收到结束符）时取它所在行的行首。 */
  resume: LineStart;
}

const BEL = 0x07;
const ESC = 0x1b;

/** 位置 i 的 `ESC ]` 没匹配成完整 OSC，且后面还没有能结束它的 BEL / ESC：再来文字可能把它（连同中间的换行）变成 OSC。 */
function openOsc(source: string, i: number): boolean {
  if (source.charCodeAt(i + 1) !== 0x5d) return false;
  for (let j = i + 2; j < source.length; j += 1) {
    const code = source.charCodeAt(j);
    if (code === BEL) return false;
    if (code === ESC) return j === source.length - 1;
  }
  return true;
}

function parseFrom(source: string, start: LineStart, kept: readonly AnsiRun[][]): AnsiParse {
  const lines: AnsiRun[][] = kept.slice(0, start.line);
  let cells: Cell[] = [];
  let col = 0;
  let pen: Pen = start.pen;
  let href = start.href;
  // 当前行行首的状态（标量，换行时不分配对象）；unstable 是第一个没收到结束符的 OSC 所在行的行首。
  let linePos = start.pos;
  let lineIndex = start.line;
  let linePen = pen;
  let lineHref = href;
  let unstable: LineStart | null = null;

  const put = (ch: string): void => {
    const cell: Cell = { ch, pen, href };
    if (col < cells.length) cells[col] = cell;
    else {
      while (cells.length < col) cells.push({ ch: " ", pen: {}, href: undefined });
      cells.push(cell);
    }
    col += 1;
  };
  const endLine = (): void => {
    lines.push(toRuns(cells));
    cells = [];
    col = 0;
  };

  let i = start.pos;
  while (i < source.length) {
    const ch = String.fromCodePoint(source.codePointAt(i)!);
    if (ch === "\u001b") {
      ESCAPE.lastIndex = i;
      const match = ESCAPE.exec(source);
      if (unstable === null && (match === null || match[3] === undefined) && openOsc(source, i)) {
        unstable = { pos: linePos, line: lineIndex, pen: linePen, href: lineHref };
      }
      if (!match) {
        i += 1;
        continue;
      }
      i = ESCAPE.lastIndex;
      if (match[2] !== undefined) {
        const params = match[1] ?? "";
        const final = match[2];
        if (final === "m") {
          const numbers = params === "" ? [0] : params.split(/[;:]/).map((n) => (n === "" ? 0 : Number(n)));
          pen = applySgr(pen, numbers);
        } else if (final === "K") {
          const mode = Number(params || "0");
          if (mode === 0) cells.length = Math.min(cells.length, col);
          else if (mode === 2) cells = [];
        } else if (final === "C") col += Math.max(1, Number(params || "1"));
        else if (final === "D") col = Math.max(0, col - Math.max(1, Number(params || "1")));
        else if (final === "G") col = Math.max(0, Number(params || "1") - 1);
      } else if (match[3] !== undefined && match[3].startsWith("8;")) {
        // OSC 8 ; params ; URI：URI 为空 = 结束链接。
        const uri = match[3].slice(match[3].indexOf(";", 2) + 1);
        href = uri === "" ? undefined : uri;
      }
      continue;
    }
    i += ch.length;
    if (ch === "\n") {
      endLine();
      linePos = i;
      lineIndex = lines.length;
      linePen = pen;
      lineHref = href;
    } else if (ch === "\r") col = 0;
    else if (ch === "\b") col = Math.max(0, col - 1);
    else if (ch === "\t") {
      const stop = (Math.floor(col / 8) + 1) * 8;
      // put() 把 col 往后推。
      // eslint-disable-next-line no-unmodified-loop-condition
      while (col < stop) put(" ");
    } else if (ch >= " " || ch === "\u00a0") put(ch);
  }
  if (cells.length > 0 || lines.length === 0 || !source.endsWith("\n")) endLine();
  return {
    source,
    lines,
    resume: unstable ?? { pos: linePos, line: lineIndex, pen: linePen, href: lineHref },
  };
}

const origin: LineStart = { pos: 0, line: 0, pen: {}, href: undefined };

/** 把带转义序列的输出拆成行，每行是一串样式片段。末尾的换行不产生空行。 */
export function parseAnsi(source: string): AnsiRun[][] {
  return parseFrom(source, origin, []).lines;
}

/**
 * 流式输出用：结果与 parseAnsi(source) 相同。source 是 prev.source 的延长时只从 prev 的续解析点往后解析，
 * 之前的行原样复用（同一个数组对象，AnsiLine 的 memo 因此命中）；否则整段重解析。
 * 行一旦遇到 \n 就定型（\r、\b、CSI K/C/D/G 只动当前行），唯一例外是没收到结束符的 OSC，见 AnsiParse.resume。
 */
export function parseAnsiStream(prev: AnsiParse | null, source: string): AnsiParse {
  if (prev !== null && source.startsWith(prev.source)) return parseFrom(source, prev.resume, prev.lines);
  return parseFrom(source, origin, []);
}
