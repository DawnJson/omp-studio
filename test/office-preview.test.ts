// 右侧预览的 Office 文档：主进程把 Word / Excel / PowerPoint 转成一份 HTML（kind "document"），内容可读、文字转义、表格过大时截断。
// fixtures/office/ 下的三份文件由 python-docx / openpyxl / python-pptx 生成；xls / ods 用 SheetJS 现写。
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from "../src/main/files/office-preview.ts";
import { readPreviewFile } from "../src/main/files/preview-file.ts";

const fixtures = path.join(import.meta.dirname, "..", "fixtures", "office");
let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "omp 预览 文档 "));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 10 });
});

async function preview(fixture: string, name = fixture) {
  await copyFile(path.join(fixtures, fixture), path.join(work, name));
  return readPreviewFile(work, name);
}

/** 只取正文里的文字（去掉标签），断言内容不依赖库的具体标签写法。 */
const textOf = (html: string): string =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Office 文档预览", () => {
  it("Word：标题、段落、列表、表格和内嵌图片都在，文件名带空格和中文", async () => {
    const file = await preview("report.docx", "季度 报告.docx");
    expect(file).toMatchObject({ kind: "document", path: "季度 报告.docx", canOpen: true });
    const html = file.text ?? "";
    expect(textOf(html)).toContain("季度报告 Quarterly report");
    expect(textOf(html)).toContain("第一段：收入增长 12%。");
    expect(html).toMatch(/<table>[\s\S]*华东[\s\S]*<\/table>/);
    // 单元格里的 "<b>42</b>" 是文字，不能变成标签。
    expect(html).not.toContain("<b>42</b>");
    expect(textOf(html)).toContain("<b>42</b>");
    expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
  });

  it("Excel：每个工作表一张表，表名做标题，单元格里的标签只当文字", async () => {
    const file = await preview("sales.xlsx");
    expect(file.kind).toBe("document");
    expect(file.truncated).toBe(false);
    const html = file.text ?? "";
    expect(html.match(/<table/g)).toHaveLength(2);
    const text = textOf(html);
    expect(text.indexOf("销售")).toBeLessThan(text.indexOf("Notes"));
    expect(text).toContain("合并单元格");
    expect(text).toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/colspan="2"/);
  });

  it("Excel：超过行数 / 列数上限只画前面一部分并标出 truncated", async () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS + 5 }, (_, r) =>
      Array.from({ length: SHEET_MAX_COLS + 3 }, (_, c) => `r${r}c${c}`),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "big");
    await writeFile(path.join(work, "big.xlsx"), XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const file = await readPreviewFile(work, "big.xlsx");
    expect(file.truncated).toBe(true);
    const html = file.text ?? "";
    expect(html).toContain(`r${SHEET_MAX_ROWS - 1}c0`);
    expect(html).not.toContain(`r${SHEET_MAX_ROWS}c0`);
    expect(html).toContain(`r0c${SHEET_MAX_COLS - 1}`);
    expect(html).not.toContain(`r0c${SHEET_MAX_COLS}`);
  });

  it.each([
    ["xls", "biff8"],
    ["ods", "ods"],
  ] as const)("老格式和 OpenDocument 表格（.%s）也能预览", async (ext, bookType) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["名称", "值"],
        ["甲", 1],
      ]),
      "表一",
    );
    await writeFile(path.join(work, `t.${ext}`), XLSX.write(book, { type: "buffer", bookType }) as Buffer);
    const file = await readPreviewFile(work, `t.${ext}`);
    expect(file.kind).toBe("document");
    expect(textOf(file.text ?? "")).toContain("名称 值 甲 1");
  });

  it("PowerPoint：按放映顺序每页一节，标题、分级文字、图片、表格都在，文字转义", async () => {
    const file = await preview("deck.pptx");
    expect(file.kind).toBe("document");
    const html = file.text ?? "";
    const slides = html.split('<section class="slide">').slice(1);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain("<h2>项目进展</h2>");
    expect(slides[0]).toContain("<p>已完成：登录</p>");
    expect(slides[0]).toMatch(/<p style="margin-left: 1\.5em">子项：OAuth<\/p>/);
    expect(textOf(slides[1] ?? "")).toContain("Slide two & <more>");
    expect(slides[1]).not.toContain("<more>");
    expect(slides[1]).toMatch(/<img src="data:image\/png;base64,/);
    expect(textOf(slides[1] ?? "")).toContain("A B 1 2");
  });

  it('损坏的文件读取失败（交给界面显示"读取失败"），不当成文本', async () => {
    await writeFile(path.join(work, "broken.docx"), "not a zip");
    await expect(readPreviewFile(work, "broken.docx")).rejects.toThrow();
  });
});
