// 输入框里的附件和大段粘贴（纯函数，test/composer-tokens.test.ts 覆盖）。语义照 omp 18.12.5 的输入框：
// - 草稿文字里的占位符是 omp 自己的写法：图片 `[Image #N, WxH]`，大段粘贴 `[Paste #N, +X lines]` / `[Paste #N, M chars]`；
// - 发送时粘贴占位符换回原文，图片按在文字里出现的编号排序后重新编号 1..k，没被引用的图片丢掉（omp 的 oHt）；
// - 粘贴编号只增不减（计数器随草稿，发送后清零），图片编号是位置（删掉一张，后面的往前补）。
// 输入框里显示的不是占位符，是紧凑的 `#N` 芯片：显示文本（view）里每个占位符换成 `OPEN nbsp #N nbsp CLOSE`，
// 控制字符都是零宽的，所以文本框里的字符和后面画芯片底色的那一层逐字对应。
// 显示编号（displayNumber）是所有附件共用的一个计数（图片、文件、粘贴依次 #1..#N），卡片和芯片一致；
// 草稿文字和发给 omp 的仍是各类自己的编号（omp 的图片 / 粘贴各有一套），发送时的转换不变。
import type { ComposerFile, PromptImage, RestoredDraft } from "../../../../shared/ipc.ts";
import { fileSlot } from "../../../../shared/composer-files.ts";

export interface DraftImage extends PromptImage {
  /** 缩放后的像素尺寸；队列撤回的图片没有。 */
  width?: number;
  height?: number;
}

/** 文件附件：id 是主进程登记表里的不透明 id（路径不在渲染进程里）。 */
export type DraftFile = ComposerFile;

export interface Draft {
  text: string;
  images: readonly DraftImage[];
  /** 文件附件（和图片一样按位置编号）。发送时文字里的 `[File #N, 名字]` 换成主进程填的 `@"路径"`。 */
  files: readonly DraftFile[];
  /** 大段粘贴的原文，键是占位符里的编号。 */
  pastes: Readonly<Record<number, string>>;
  /** 已经发过的最大粘贴编号（删掉占位符也不回退，和 omp 一致）。 */
  pasteCounter: number;
}

export const EMPTY_DRAFT: Draft = { text: "", images: [], files: [], pastes: {}, pasteCounter: 0 };

export type TokenKind = "image" | "paste" | "file";

/** omp 的 `#nt`：超过 10 行或超过 1000 个字符就折叠成占位符。 */
const PASTE_MAX_LINES = 10;
const PASTE_MAX_CHARS = 1000;

/** omp 对粘贴文字的整理（`#Re`）：换行统一成 \n，NFC，Tab 换成 3 个空格，去掉其余控制字符。 */
export function normalizePaste(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      .normalize("NFC")
      .replace(/\t/g, "   ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x09\x0B-\x1F]/g, "")
  );
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

/** 整理后的文字要不要折叠。 */
export function isLargePaste(normalized: string): boolean {
  return lineCount(normalized) > PASTE_MAX_LINES || normalized.length > PASTE_MAX_CHARS;
}

function imageMarker(n: number, image: DraftImage | undefined): string {
  return image?.width !== undefined && image.height !== undefined
    ? `[Image #${n}, ${image.width}x${image.height}]`
    : `[Image #${n}]`;
}

/** 文件占位符 `[File #N, 名字]`（studio 自己的写法，omp 没有文件附件；发送时换成 omp 的 `@"路径"` 提及）。名字里的 `]` 和换行换成 `_`。 */
function fileMarker(n: number, file: DraftFile | undefined): string {
  return file === undefined ? `[File #${n}]` : `[File #${n}, ${file.name.replace(/[\]\n\r]/g, "_")}]`;
}

/** 行数超过 10：`+X lines`（X 是总行数，和 omp 一样）；否则（只是字符多）`M chars`。 */
export function pasteMarker(n: number, content: string): string {
  const lines = lineCount(content);
  return lines > PASTE_MAX_LINES ? `[Paste #${n}, +${lines} lines]` : `[Paste #${n}, ${content.length} chars]`;
}

const tokenSource = String.raw`\[(Image|Paste|File) #([1-9]\d*)(?:,[^\]\n]*)?\]`;

export interface TokenSpan {
  kind: TokenKind;
  n: number;
  start: number;
  end: number;
}

/** 文字里和现有附件对得上的占位符（编号超出的、没有原文的 `[Paste #9]` 只是普通文字）。 */
function scanTokens(text: string, draft: Pick<Draft, "images" | "files" | "pastes">): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const match of text.matchAll(new RegExp(tokenSource, "g"))) {
    const kind: TokenKind = match[1] === "Image" ? "image" : match[1] === "File" ? "file" : "paste";
    const n = Number(match[2]);
    const known =
      kind === "image"
        ? n <= draft.images.length
        : kind === "file"
          ? n <= draft.files.length
          : draft.pastes[n] !== undefined;
    if (known) spans.push({ kind, n, start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** 按位置编号的附件（图片、文件）：文字里引用到的留下，按旧编号的顺序重新编号 1..k。 */
function renumber<T>(items: readonly T[], spans: readonly TokenSpan[], kind: TokenKind) {
  const used = [...new Set(spans.filter((span) => span.kind === kind).map((span) => span.n))].sort((a, b) => a - b);
  return {
    intact: used.length === items.length,
    kept: used.map((old) => items[old - 1]!),
    rank: new Map(used.map((old, index) => [old, index + 1])),
  };
}

/** 文字里不再引用的附件删掉；图片和文件按旧编号的顺序重新编号并改写文字里的占位符。 */
export function reconcileDraft(draft: Draft): Draft {
  if (draft.images.length === 0 && draft.files.length === 0 && Object.keys(draft.pastes).length === 0) return draft;
  const spans = scanTokens(draft.text, draft);
  const usedPastes = new Set(spans.filter((span) => span.kind === "paste").map((span) => span.n));
  const images = renumber(draft.images, spans, "image");
  const files = renumber(draft.files, spans, "file");
  if (images.intact && files.intact && usedPastes.size === Object.keys(draft.pastes).length) return draft;
  const pastes = Object.fromEntries(Object.entries(draft.pastes).filter(([n]) => usedPastes.has(Number(n))));
  let text = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.kind === "paste") continue;
    text += draft.text.slice(cursor, span.start);
    text +=
      span.kind === "image"
        ? imageMarker(images.rank.get(span.n)!, images.kept[images.rank.get(span.n)! - 1])
        : fileMarker(files.rank.get(span.n)!, files.kept[files.rank.get(span.n)! - 1]);
    cursor = span.end;
  }
  text += draft.text.slice(cursor);
  return { ...draft, text, images: images.kept, files: files.kept, pastes };
}

export interface Inserted {
  draft: Draft;
  /** 插入之后的光标位置（文字里的偏移）。 */
  caret: number;
}

/** 在 offset 处插入一段占位符：前面不是空白就补一个空格，后面补一个空格（omp 的 insertAtom 也是 `标签 `）。 */
function insertAt(text: string, offset: number, inserted: string): { text: string; caret: number } {
  const at = Math.min(Math.max(offset, 0), text.length);
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before === "" || /\s$/.test(before) ? "" : " ";
  const added = `${lead}${inserted} `;
  return { text: before + added + after, caret: before.length + added.length };
}

/** offset 落在某个占位符里面（异步插入期间文字变了）就挪到它后面，免得把占位符拦腰截断。 */
export function offsetOutsideTokens(draft: Draft, offset: number): number {
  const inside = scanTokens(draft.text, draft).find((span) => offset > span.start && offset < span.end);
  return inside?.end ?? offset;
}

export function insertImages(draft: Draft, images: readonly DraftImage[], offset: number): Inserted {
  if (images.length === 0) return { draft, caret: offset };
  const all = [...draft.images, ...images];
  const markers = images.map((image, index) => imageMarker(draft.images.length + index + 1, image)).join(" ");
  const inserted = insertAt(draft.text, offset, markers);
  return { draft: { ...draft, text: inserted.text, images: all }, caret: inserted.caret };
}

export function insertFiles(draft: Draft, files: readonly DraftFile[], offset: number): Inserted {
  if (files.length === 0) return { draft, caret: offset };
  const markers = files.map((file, index) => fileMarker(draft.files.length + index + 1, file)).join(" ");
  const inserted = insertAt(draft.text, offset, markers);
  return { draft: { ...draft, text: inserted.text, files: [...draft.files, ...files] }, caret: inserted.caret };
}

/** 折叠一段大粘贴（先按 omp 的方式整理）：返回 null 表示它不大，按普通文字粘贴。 */
export function insertPaste(draft: Draft, raw: string, offset: number): Inserted | null {
  const content = normalizePaste(raw);
  if (!isLargePaste(content)) return null;
  const n = draft.pasteCounter + 1;
  const inserted = insertAt(draft.text, offset, pasteMarker(n, content));
  return {
    draft: { ...draft, text: inserted.text, pastes: { ...draft.pastes, [n]: content }, pasteCounter: n },
    caret: inserted.caret,
  };
}

/** 去掉某个附件在文字里的所有占位符（连同后面一个空格），附件随之由 reconcileDraft 清理。 */
export function removeAttachment(draft: Draft, kind: TokenKind, n: number): Draft {
  const spans = scanTokens(draft.text, draft).filter((span) => span.kind === kind && span.n === n);
  let text = "";
  let cursor = 0;
  for (const span of spans) {
    text += draft.text.slice(cursor, span.start);
    cursor = draft.text[span.end] === " " ? span.end + 1 : span.end;
  }
  text += draft.text.slice(cursor);
  // 没被任何占位符引用的附件由 reconcileDraft 清掉。
  return reconcileDraft({ ...draft, text });
}

/** 把 added 接在 current 后面（空行分隔）：added 里的占位符编号顺延，免得和 current 的重号。 */
export function appendDraft(current: Draft, added: Draft): Draft {
  if (added.text === "" && added.images.length === 0 && added.files.length === 0) return current;
  const imageShift = current.images.length;
  const fileShift = current.files.length;
  const pasteShift = current.pasteCounter;
  const shifted = added.text.replace(new RegExp(tokenSource, "g"), (whole, kind: string, n: string) => {
    const old = Number(n);
    if (kind === "Image") {
      return old <= added.images.length ? imageMarker(old + imageShift, added.images[old - 1]) : whole;
    }
    if (kind === "File") {
      return old <= added.files.length ? fileMarker(old + fileShift, added.files[old - 1]) : whole;
    }
    return added.pastes[old] === undefined ? whole : pasteMarker(old + pasteShift, added.pastes[old]);
  });
  const pastes: Record<number, string> = { ...current.pastes };
  for (const [n, content] of Object.entries(added.pastes)) pastes[Number(n) + pasteShift] = content;
  return {
    text: [current.text, shifted].filter((part) => part !== "").join("\n\n"),
    images: [...current.images, ...added.images],
    files: [...current.files, ...added.files],
    pastes,
    pasteCounter: current.pasteCounter + added.pasteCounter,
  };
}

/** 撤回 / 预填的消息变成草稿：文字里已用 `[Image #k]` 标好图片位置（`RestoredDraft`），逐条空行分隔接起来，编号由 appendDraft 顺延。 */
export function draftFromRestored(restored: readonly RestoredDraft[]): Draft {
  return restored.reduce<Draft>(
    (draft, item) => appendDraft(draft, { ...EMPTY_DRAFT, text: item.text, images: item.images ?? [] }),
    EMPTY_DRAFT,
  );
}

export interface Submission {
  /** 粘贴占位符已换回原文、图片占位符按出现的编号重排后的文字（没有 trim）。 */
  text: string;
  /** 被文字引用的图片，下标 + 1 就是占位符里的编号。 */
  images: DraftImage[];
  /** 被文字引用的文件；文字里对应的位置是 `fileSlot(下标 + 1)`，主进程换成 `@"路径"`。 */
  files: DraftFile[];
}

/** 发给 omp 的内容（omp 的 `getExpandedText` + 提交时对没引用的图片的处理，`oHt`）。 */
export function buildSubmission(draft: Draft): Submission {
  const spans = scanTokens(draft.text, draft);
  const images = renumber(draft.images, spans, "image");
  const files = renumber(draft.files, spans, "file");
  let text = "";
  let cursor = 0;
  for (const span of spans) {
    text += draft.text.slice(cursor, span.start);
    if (span.kind === "paste") text += draft.pastes[span.n]!;
    else if (span.kind === "image") {
      const n = images.rank.get(span.n)!;
      text += imageMarker(n, images.kept[n - 1]);
    } else text += fileSlot(files.rank.get(span.n)!);
    cursor = span.end;
  }
  text += draft.text.slice(cursor);
  return { text, images: images.kept, files: files.kept };
}

const attachmentMarkerPattern = /\[Image #[1-9]\d*(?:,[^\]\n]*)?\]|\uE000file:\d+\uE001/g;

/** 输入历史里存的文字：粘贴换回原文，图片和文件占位符去掉（回放时没有附件可挂）。 */
export function historyText(draft: Draft): string {
  return buildSubmission(draft)
    .text.replace(attachmentMarkerPattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 草稿落盘的文字（附件和粘贴原文不落盘）：粘贴换回原文、图片占位符去掉；超过 limit 个字符时退回带占位符的文字。 */
export function persistedText(draft: Draft, limit: number): string {
  if (draft.images.length === 0 && draft.files.length === 0 && draft.pasteCounter === 0) return draft.text;
  const expanded = buildSubmission(draft).text.replace(attachmentMarkerPattern, "");
  return expanded.length <= limit ? expanded : draft.text;
}

// ───── 显示文本（view）：占位符 ↔ 芯片 ─────

const OPEN_IMAGE = "\u2062";
const OPEN_FILE = "\u2061";
const OPEN_PASTE = "\u2063";
const CLOSE = "\u2064";
const NBSP = "\u00a0";
const viewTokenPattern = /([\u2061\u2062\u2063])([^\u2061\u2062\u2063\u2064\n]*)\u2064/g;
const strayPattern = /[\u2061\u2062\u2063\u2064]/g;

export interface ChipLabels {
  /** 芯片里写的字：`#1`、`#2 +40 行`。 */
  image(n: number): string;
  paste(n: number, content: string): string;
  file(n: number, name: string): string;
}

/** 图片 `#1`；粘贴 `#2 +40 行`（行数不超过 10、只是字符多时 `#2 1500 字符`）。linesWord / charsWord 是两种语言里的"行"/"字符"。 */
export function chipLabels(linesWord: string, charsWord: string): ChipLabels {
  return {
    image: (n) => `#${n}`,
    file: (n, name) => `#${n} ${name.length > 16 ? `${name.slice(0, 15)}…` : name}`,
    paste: (n, content) => {
      const lines = lineCount(content);
      return lines > PASTE_MAX_LINES ? `#${n} +${lines} ${linesWord}` : `#${n} ${content.length} ${charsWord}`;
    },
  };
}

export interface ViewSpan extends TokenSpan {
  /** 在 view 里的范围（含两端的控制字符和空格）。 */
  viewStart: number;
  viewEnd: number;
}

export interface DraftView {
  text: string;
  spans: ViewSpan[];
}

const chipBody = (label: string) => `${NBSP}${label.replaceAll(" ", NBSP)}${NBSP}`;

/**
 * 界面显示用的编号：所有附件共用一个计数 1..N（图片在前，然后文件，然后粘贴按粘贴编号排），
 * 免得图片 `#1`、文件 `#1`、粘贴 `#1` 三个不同的东西撞号。草稿文字里和发给 omp 的仍是各类自己的编号。
 */
export function displayNumber(draft: Pick<Draft, "images" | "files" | "pastes">, kind: TokenKind, n: number): number {
  if (kind === "image") return n;
  if (kind === "file") return draft.images.length + n;
  const rank = Object.keys(draft.pastes).filter((key) => Number(key) < n).length + 1;
  return draft.images.length + draft.files.length + rank;
}

/** displayNumber 的反向：显示编号 → 该类自己的编号（对不上返回 null）。 */
function sourceNumber(
  draft: Pick<Draft, "images" | "files" | "pastes">,
  kind: TokenKind,
  shown: number,
): number | null {
  if (kind === "image") return shown >= 1 && shown <= draft.images.length ? shown : null;
  const fileEnd = draft.images.length + draft.files.length;
  if (kind === "file") return shown > draft.images.length && shown <= fileEnd ? shown - draft.images.length : null;
  const keys = Object.keys(draft.pastes)
    .map(Number)
    .sort((a, b) => a - b);
  return keys[shown - fileEnd - 1] ?? null;
}

export function buildView(draft: Draft, labels: ChipLabels): DraftView {
  const spans = scanTokens(draft.text, draft);
  let text = "";
  let cursor = 0;
  const out: ViewSpan[] = [];
  for (const span of spans) {
    text += draft.text.slice(cursor, span.start);
    const viewStart = text.length;
    const open = span.kind === "image" ? OPEN_IMAGE : span.kind === "file" ? OPEN_FILE : OPEN_PASTE;
    const shown = displayNumber(draft, span.kind, span.n);
    const label =
      span.kind === "image"
        ? labels.image(shown)
        : span.kind === "file"
          ? labels.file(shown, draft.files[span.n - 1]!.name)
          : labels.paste(shown, draft.pastes[span.n]!);
    text += `${open}${chipBody(label)}${CLOSE}`;
    out.push({ ...span, viewStart, viewEnd: text.length });
    cursor = span.end;
  }
  text += draft.text.slice(cursor);
  return { text, spans: out };
}

/** 文本框里的内容变回草稿文字：完整的芯片换回占位符，被改坏的芯片只留可见的字，其余控制字符丢掉。 */
export function viewToText(view: string, draft: Draft): string {
  const restored = view.replace(viewTokenPattern, (_whole, open: string, body: string) => {
    const shown = Number(/#(\d+)/.exec(body)?.[1]);
    if (open === OPEN_IMAGE) {
      const n = sourceNumber(draft, "image", shown);
      if (n !== null) return imageMarker(n, draft.images[n - 1]);
    } else if (open === OPEN_FILE) {
      const n = sourceNumber(draft, "file", shown);
      if (n !== null) return fileMarker(n, draft.files[n - 1]);
    } else {
      const n = sourceNumber(draft, "paste", shown);
      if (n !== null) return pasteMarker(n, draft.pastes[n]!);
    }
    return body.replaceAll(NBSP, " ").trim();
  });
  return restored.replace(strayPattern, "");
}

/** view 里的偏移 → 文字里的偏移（落在芯片里面的按芯片的起点算）。 */
export function viewToTextOffset(view: DraftView, offset: number): number {
  let shift = 0;
  for (const span of view.spans) {
    if (offset <= span.viewStart) break;
    if (offset >= span.viewEnd) shift += span.viewEnd - span.viewStart - (span.end - span.start);
    else return span.start;
  }
  return offset - shift;
}

/** 文字里的偏移 → view 里的偏移。 */
export function textToViewOffset(view: DraftView, offset: number): number {
  let shift = 0;
  for (const span of view.spans) {
    if (offset <= span.start) break;
    if (offset >= span.end) shift += span.viewEnd - span.viewStart - (span.end - span.start);
    else return span.viewStart;
  }
  return offset + shift;
}

/** 选区不能落在芯片里面：起点往前、终点往后贴到芯片边上；光标（起点 = 终点）贴到更近的一边。 */
export function snapSelection(view: DraftView, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  for (const span of view.spans) {
    const inside = (position: number) => position > span.viewStart && position < span.viewEnd;
    if (start === end) {
      if (inside(from)) {
        const edge = from - span.viewStart < span.viewEnd - from ? span.viewStart : span.viewEnd;
        from = edge;
        to = edge;
      }
    } else {
      if (inside(from)) from = span.viewStart;
      if (inside(to)) to = span.viewEnd;
    }
  }
  return [from, to];
}

/** 光标紧贴芯片的哪一边：Backspace / ← 看光标前面，Delete / → 看光标后面。 */
export function chipTouching(view: DraftView, caret: number, side: "before" | "after"): ViewSpan | null {
  return view.spans.find((span) => (side === "before" ? span.viewEnd === caret : span.viewStart === caret)) ?? null;
}

/** 文件卡片上的大小：`812 B` / `34 KB` / `1.2 MB`。 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 给界面显示用（第一句话的气泡）：文件占位符换成 `@名字`，不暴露路径。 */
export function slotsToNames(text: string, files: readonly DraftFile[]): string {
  return text.replace(/\uE000file:(\d+)\uE001/g, (whole, n: string) => {
    const file = files[Number(n) - 1];
    return file === undefined ? whole : `@${file.name}`;
  });
}
