// 右侧预览里的 Office 文档：在主进程转成一份完整的 HTML，渲染进程放进不带脚本、不带 allow-same-origin 的 sandbox iframe。
// Word 用 mammoth（只取内容和结构，不还原版式），表格用 SheetJS（每个工作表一张表），PowerPoint 自己读 pptx 里的 XML：
// 每页按形状顺序列出文字、图片和表格，不还原位置和动画。所有文字都经过转义，iframe 里也不跑脚本。
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const wordExtensions = new Set([".docx"]);
const sheetExtensions = new Set([".xlsx", ".xlsm", ".xls", ".ods"]);
const slideExtensions = new Set([".pptx"]);

/** 每个工作表最多画这么多行、列；超出部分不画，结果带 truncated。 */
export const SHEET_MAX_ROWS = 1000;
export const SHEET_MAX_COLS = 100;

export function isOfficeExtension(ext: string): boolean {
  return wordExtensions.has(ext) || sheetExtensions.has(ext) || slideExtensions.has(ext);
}

export interface OfficeHtml {
  html: string;
  /** 表格超出 SHEET_MAX_ROWS / SHEET_MAX_COLS，只画了前面一部分。 */
  truncated: boolean;
}

// 文档自己的版面（iframe 里是一张白纸，和 HTML 预览一样不跟应用主题）：字面值只在这份文档里，不进应用的样式。
const documentCss = `
body { margin: 24px; font: 14px/1.6 "Segoe UI", "Microsoft YaHei UI", sans-serif; color: #1f2328; background: #fff; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 8px 0 16px; }
th, td { border: 1px solid #d0d7de; padding: 2px 8px; vertical-align: top; height: 1.6em; }
td p, th p, section.slide td p { margin: 0; }
h2.sheet { font-size: 15px; margin: 16px 0 4px; }
section.slide { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 20px 16px; margin: 0 0 16px; }
section.slide > .no { color: #656d76; font-size: 12px; }
section.slide p { margin: 4px 0; }
`;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${documentCss}</style></head><body>${body}</body></html>`;
}

export async function renderOfficeHtml(bytes: Buffer, ext: string): Promise<OfficeHtml> {
  if (wordExtensions.has(ext)) {
    // 图片默认内嵌成 data URL（应用的 CSP 允许 data: 图片）。
    const result = await mammoth.convertToHtml({ buffer: bytes });
    return { html: page(result.value), truncated: false };
  }
  if (sheetExtensions.has(ext)) return renderSheets(bytes);
  return { html: page(await renderSlides(bytes)), truncated: false };
}

function renderSheets(bytes: Buffer): OfficeHtml {
  const book = XLSX.read(bytes, { type: "buffer", cellDates: true });
  let truncated = false;
  const parts = book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const ref = sheet?.["!ref"];
    if (sheet === undefined || ref === undefined) return `<h2 class="sheet">${escapeHtml(name)}</h2>`;
    const range = XLSX.utils.decode_range(ref);
    const lastRow = Math.min(range.e.r, range.s.r + SHEET_MAX_ROWS - 1);
    const lastCol = Math.min(range.e.c, range.s.c + SHEET_MAX_COLS - 1);
    if (lastRow < range.e.r || lastCol < range.e.c) truncated = true;
    sheet["!ref"] = XLSX.utils.encode_range({ s: range.s, e: { r: lastRow, c: lastCol } });
    const table = XLSX.utils.sheet_to_html(sheet, { header: "", footer: "" });
    return `<h2 class="sheet">${escapeHtml(name)}</h2>${table}`;
  });
  return { html: page(parts.join("")), truncated };
}

// ───────── pptx ─────────

const imageMime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

type XmlElement = Element;

function childElements(node: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) out.push(child as XmlElement);
  }
  return out;
}

function firstChild(node: XmlElement, name: string): XmlElement | undefined {
  return childElements(node).find((child) => child.localName === name);
}

function descendants(node: XmlElement, name: string): XmlElement[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

function parseXml(text: string): XmlElement {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.documentElement as unknown as XmlElement;
}

/** `.rels` 文件：关系 id → zip 里的绝对路径（相对于这个部件所在目录解析）。 */
async function readRels(zip: JSZip, part: string): Promise<Map<string, string>> {
  const relsPath = path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
  const text = await zip.file(relsPath)?.async("string");
  const rels = new Map<string, string>();
  if (text === undefined) return rels;
  for (const rel of descendants(parseXml(text), "Relationship")) {
    if (rel.getAttribute("TargetMode") === "External") continue;
    const target = rel.getAttribute("Target") ?? "";
    const resolved = target.startsWith("/")
      ? target.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(part), target));
    rels.set(rel.getAttribute("Id") ?? "", resolved);
  }
  return rels;
}

/** 一段文字：`a:r` / `a:fld` 里的 `a:t`，`a:br` 换行。 */
function paragraphText(paragraph: XmlElement): string {
  let text = "";
  for (const child of childElements(paragraph)) {
    if (child.localName === "br") text += "\n";
    else if (child.localName === "r" || child.localName === "fld") text += firstChild(child, "t")?.textContent ?? "";
  }
  return text;
}

function textBody(body: XmlElement, heading: boolean): string {
  return childElements(body)
    .filter((child) => child.localName === "p")
    .map((paragraph) => {
      const text = paragraphText(paragraph);
      if (text.trim() === "") return "";
      const html = escapeHtml(text).replace(/\n/g, "<br>");
      if (heading) return `<h2>${html}</h2>`;
      const level = Number(firstChild(paragraph, "pPr")?.getAttribute("lvl") ?? "0") || 0;
      return level > 0 ? `<p style="margin-left: ${level * 1.5}em">${html}</p>` : `<p>${html}</p>`;
    })
    .join("");
}

function isTitleShape(shape: XmlElement): boolean {
  const placeholder = descendants(shape, "ph")[0];
  const type = placeholder?.getAttribute("type");
  return type === "title" || type === "ctrTitle";
}

async function renderShapes(zip: JSZip, tree: XmlElement, rels: Map<string, string>): Promise<string> {
  const out: string[] = [];
  for (const shape of childElements(tree)) {
    switch (shape.localName) {
      case "sp": {
        const body = firstChild(shape, "txBody");
        if (body !== undefined) out.push(textBody(body, isTitleShape(shape)));
        break;
      }
      case "pic": {
        const embed = descendants(shape, "blip")[0]?.getAttribute("r:embed");
        const target = embed === undefined || embed === null ? undefined : rels.get(embed);
        const mime = target === undefined ? undefined : imageMime[path.posix.extname(target).toLowerCase()];
        const data = target === undefined || mime === undefined ? undefined : await zip.file(target)?.async("base64");
        if (data !== undefined) out.push(`<p><img src="data:${mime};base64,${data}" alt=""></p>`);
        break;
      }
      case "graphicFrame": {
        for (const table of descendants(shape, "tbl")) {
          const rows = descendants(table, "tr").map((row) => {
            const cells = childElements(row)
              .filter((cell) => cell.localName === "tc")
              .map((cell) => {
                const body = firstChild(cell, "txBody");
                return `<td>${body === undefined ? "" : textBody(body, false)}</td>`;
              });
            return `<tr>${cells.join("")}</tr>`;
          });
          out.push(`<table>${rows.join("")}</table>`);
        }
        break;
      }
      case "grpSp":
        out.push(await renderShapes(zip, shape, rels));
        break;
    }
  }
  return out.join("");
}

async function renderSlides(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const presentationPart = "ppt/presentation.xml";
  const presentation = await zip.file(presentationPart)?.async("string");
  if (presentation === undefined) throw new Error("not a pptx: ppt/presentation.xml missing");
  const rels = await readRels(zip, presentationPart);
  // 页序以 presentation.xml 的 sldIdLst 为准（slideN.xml 的编号不一定是放映顺序）。
  const slideParts = descendants(parseXml(presentation), "sldId")
    .map((slide) => rels.get(slide.getAttribute("r:id") ?? ""))
    .filter((part): part is string => part !== undefined);
  const sections: string[] = [];
  for (const [index, part] of slideParts.entries()) {
    const text = await zip.file(part)?.async("string");
    if (text === undefined) continue;
    const tree = descendants(parseXml(text), "spTree")[0];
    const body = tree === undefined ? "" : await renderShapes(zip, tree, await readRels(zip, part));
    sections.push(`<section class="slide"><div class="no">${index + 1}</div>${body}</section>`);
  }
  return sections.join("");
}
