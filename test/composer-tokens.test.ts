// 输入框的附件和大段粘贴（features/composer/composer-tokens.ts）。语义照 omp 18.12.5 的输入框（实测见 docs/architecture/composer-attachments.md）：
// 防的是：粘贴占位符没换回原文就发给了 omp；删掉芯片后附件还在；图片编号和文字里的占位符对不上。
import { describe, expect, it } from "vitest";
import {
  appendDraft,
  buildSubmission,
  buildView,
  chipLabels,
  chipTouching,
  displayNumber,
  draftFromRestored,
  EMPTY_DRAFT,
  historyText,
  formatFileSize,
  insertFiles,
  insertImages,
  insertPaste,
  offsetOutsideTokens,
  isLargePaste,
  normalizePaste,
  pasteMarker,
  persistedText,
  reconcileDraft,
  removeAttachment,
  slotsToNames,
  snapSelection,
  textToViewOffset,
  viewToText,
  viewToTextOffset,
  type Draft,
  type DraftImage,
} from "../src/renderer/src/features/composer/composer-tokens.ts";
import { clampFieldHeight, maxFieldHeight } from "../src/renderer/src/features/composer/field-height.ts";

const image = (width?: number, height?: number, data = "AAAA"): DraftImage => ({
  mimeType: "image/webp",
  data,
  ...(width !== undefined && height !== undefined ? { width, height } : {}),
});
const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
const labels = chipLabels("lines", "chars");
const draftOf = (partial: Partial<Draft>): Draft => ({ ...EMPTY_DRAFT, ...partial });

describe("粘贴折叠的阈值（omp 18.12.5：超过 10 行或超过 1000 个字符）", () => {
  it("10 行不折叠，11 行折叠；1000 字符不折叠，1001 折叠", () => {
    expect(isLargePaste(lines(10))).toBe(false);
    expect(isLargePaste(lines(11))).toBe(true);
    expect(isLargePaste("a".repeat(1000))).toBe(false);
    expect(isLargePaste("a".repeat(1001))).toBe(true);
  });
  it("占位符：行数超过 10 写 +X lines（X 是总行数），只是字符多写 M chars", () => {
    expect(pasteMarker(1, lines(40))).toBe("[Paste #1, +40 lines]");
    expect(pasteMarker(2, "a".repeat(1500))).toBe("[Paste #2, 1500 chars]");
  });
  it("折叠前先整理：CRLF / CR 换成 LF，Tab 换成 3 个空格，去掉控制字符", () => {
    expect(normalizePaste("a\r\nb\rc\td\u0007e")).toBe("a\nb\nc   de");
  });
});

describe("插入大段粘贴", () => {
  it("大的折叠成占位符，原文记在草稿里，计数器加一；占位符前后补空格", () => {
    const inserted = insertPaste(draftOf({ text: "看看" }), lines(30), 2)!;
    expect(inserted.draft.text).toBe("看看 [Paste #1, +30 lines] ");
    expect(inserted.draft.pastes[1]).toBe(lines(30));
    expect(inserted.draft.pasteCounter).toBe(1);
    expect(inserted.caret).toBe(inserted.draft.text.length);
  });
  it("不大的返回 null（按普通文字粘贴）", () => {
    expect(insertPaste(EMPTY_DRAFT, "hello\nworld", 0)).toBeNull();
  });
  it("粘贴编号只增不减：删掉 #1 再粘贴是 #2", () => {
    const first = insertPaste(EMPTY_DRAFT, lines(12), 0)!.draft;
    const cleared = reconcileDraft({ ...first, text: "" });
    expect(cleared.pastes).toEqual({});
    expect(insertPaste(cleared, lines(12), 0)!.draft.text).toBe("[Paste #2, +12 lines] ");
  });
});

describe("图片占位符和编号", () => {
  it("在光标处插入 [Image #N, WxH]，没有尺寸时写 [Image #N]", () => {
    const first = insertImages(EMPTY_DRAFT, [image(1568, 165)], 0);
    expect(first.draft.text).toBe("[Image #1, 1568x165] ");
    const second = insertImages(draftOf({ ...first.draft, text: `${first.draft.text}说明` }), [image()], first.caret);
    expect(second.draft.text).toBe("[Image #1, 1568x165] [Image #2] 说明");
    expect(second.draft.images).toHaveLength(2);
  });
  it("异步插入时光标落在占位符里面：挪到占位符后面", () => {
    const draft = draftOf({ text: "a [Image #1, 10x10] b", images: [image(10, 10)] });
    expect(offsetOutsideTokens(draft, 5)).toBe("a [Image #1, 10x10]".length);
    expect(offsetOutsideTokens(draft, 2)).toBe(2);
    expect(offsetOutsideTokens(draft, "a [Image #1, 10x10]".length)).toBe("a [Image #1, 10x10]".length);
  });
  it("删掉文字里的占位符，对应的图片跟着没了，后面的图片往前补号并改写占位符", () => {
    const draft = draftOf({
      text: "[Image #1, 10x10] a [Image #2, 20x20] b [Image #3]",
      images: [image(10, 10, "one"), image(20, 20, "two"), image(undefined, undefined, "three")],
    });
    const without = reconcileDraft({ ...draft, text: "a [Image #2, 20x20] b [Image #3]" });
    expect(without.images.map((entry) => entry.data)).toEqual(["two", "three"]);
    expect(without.text).toBe("a [Image #1, 20x20] b [Image #2]");
  });
  it("点卡片上的移除 = 去掉所有占位符和它后面的一个空格", () => {
    const draft = draftOf({
      text: "[Image #1, 10x10] 看 [Image #2, 20x20] ",
      images: [image(10, 10, "one"), image(20, 20, "two")],
    });
    const removed = removeAttachment(draft, "image", 1);
    expect(removed.text).toBe("看 [Image #1, 20x20] ");
    expect(removed.images.map((entry) => entry.data)).toEqual(["two"]);
  });
  it("编号超出现有图片的 [Image #9] 只是普通文字，不会让图片留着", () => {
    const draft = draftOf({ text: "[Image #9] x", images: [image(1, 1)] });
    expect(reconcileDraft(draft)).toMatchObject({ text: "[Image #9] x", images: [] });
  });
});

describe("发送内容（omp 的 getExpandedText + 提交时处理没引用的图片）", () => {
  it("粘贴占位符换回原文；原文里长得像占位符的字不算引用", () => {
    const content = `${lines(11)}\n[Image #1]`;
    const draft = draftOf({
      text: "总结 [Paste #1, +12 lines] 谢谢",
      pastes: { 1: content },
      pasteCounter: 1,
      images: [image(5, 5)],
    });
    const submission = buildSubmission(draft);
    expect(submission.text).toBe(`总结 ${content} 谢谢`);
    expect(submission.images).toEqual([]);
  });
  it("没被文字引用的图片不发；被引用的按编号顺序重新编号成 1..k", () => {
    const draft = draftOf({
      text: "对比 [Image #3, 30x30] 和 [Image #1, 10x10]",
      images: [image(10, 10, "one"), image(20, 20, "two"), image(30, 30, "three")],
    });
    const submission = buildSubmission(draft);
    expect(submission.images.map((entry) => entry.data)).toEqual(["one", "three"]);
    expect(submission.text).toBe("对比 [Image #2, 30x30] 和 [Image #1, 10x10]");
  });
  it("纯图片的草稿：文字就是占位符", () => {
    const draft = insertImages(EMPTY_DRAFT, [image(8, 6)], 0).draft;
    expect(buildSubmission(draft)).toMatchObject({ text: "[Image #1, 8x6] ", images: [{ data: "AAAA" }] });
  });
  it("输入历史里粘贴是原文、图片占位符去掉；落盘文字同理，超长时退回占位符", () => {
    const draft = draftOf({
      text: "[Image #1, 8x6] 看 [Paste #1, +12 lines]",
      images: [image(8, 6)],
      pastes: { 1: lines(12) },
      pasteCounter: 1,
    });
    expect(historyText(draft)).toBe(`看 ${lines(12)}`);
    expect(persistedText(draft, 10_000)).toBe(` 看 ${lines(12)}`);
    expect(persistedText(draft, 20)).toBe(draft.text);
  });
});

describe("拼接草稿（发送失败放回、撤回排队消息）", () => {
  it("后面的草稿里的编号顺延，免得和现有的重号", () => {
    const current = draftOf({
      text: "[Image #1, 1x1] 前",
      images: [image(1, 1, "a")],
      pastes: { 1: lines(12) },
      pasteCounter: 1,
    });
    const added = draftOf({
      text: "[Image #1, 2x2] [Paste #1, +12 lines] 后",
      images: [image(2, 2, "b")],
      pastes: { 1: lines(12) },
      pasteCounter: 1,
    });
    const merged = appendDraft({ ...current, text: `${current.text} [Paste #1, +12 lines]` }, added);
    expect(merged.text).toBe("[Image #1, 1x1] 前 [Paste #1, +12 lines]\n\n[Image #2, 2x2] [Paste #2, +12 lines] 后");
    expect(merged.images.map((entry) => entry.data)).toEqual(["a", "b"]);
    expect(Object.keys(merged.pastes)).toEqual(["1", "2"]);
    expect(merged.pasteCounter).toBe(2);
  });
  it("排队撤回的纯文字 + 图片：图片占位符放在文字后面", () => {
    const draft = draftFromRestored(["第一条", "第二条"], [image(), image(3, 3)]);
    expect(draft.text).toBe("第一条\n\n第二条 [Image #1] [Image #2, 3x3]");
    expect(draft.images).toHaveLength(2);
  });
});

describe("输入框里的芯片（view 文本）", () => {
  const draft = draftOf({
    text: "a [Image #1, 10x10] b [Paste #1, +30 lines] c",
    images: [image(10, 10)],
    pastes: { 1: lines(30) },
    pasteCounter: 1,
  });
  const view = buildView(draft, labels);

  it("占位符显示成 #N 芯片，文本框的内容转回来和草稿文字逐字一致", () => {
    expect(view.text).not.toContain("[Image");
    expect(view.text).toContain("#1");
    expect(view.text).toContain("#2\u00a0+30\u00a0lines");
    expect(viewToText(view.text, draft)).toBe(draft.text);
  });
  it("显示编号全部附件共用一个计数：图片 #1 #2、文件 #3、粘贴 #4，转回来仍是各类自己的编号", () => {
    const mixed = draftOf({
      text: "[Image #1, 1x1] [Image #2, 2x2] [File #1, a.txt] [Paste #3, +30 lines]",
      images: [image(1, 1), image(2, 2)],
      files: [{ id: "f1", name: "a.txt", size: 5 }],
      pastes: { 3: lines(30) },
      pasteCounter: 3,
    });
    const shown = buildView(mixed, labels).text;
    expect([...shown.matchAll(/#(\d+)/g)].map((match) => match[1])).toEqual(["1", "2", "3", "4"]);
    expect(displayNumber(mixed, "paste", 3)).toBe(4);
    expect(viewToText(shown, mixed)).toBe(mixed.text);
  });
  it("芯片被改坏（少了结束字符）：只留可见的字，不留零宽字符，附件由 reconcile 清理", () => {
    const broken = view.text.replace("\u2064", "");
    const restored = viewToText(broken, draft);
    expect(restored).not.toMatch(/[\u2062\u2063\u2064]/);
    expect(reconcileDraft({ ...draft, text: restored }).images).toEqual([]);
  });
  it("文字里的偏移和 view 里的偏移互相换算；落在芯片里的算芯片起点", () => {
    const afterImage = draft.text.indexOf(" b ");
    const viewAfter = textToViewOffset(view, afterImage);
    expect(view.text.slice(viewAfter, viewAfter + 3)).toBe(" b ");
    expect(viewToTextOffset(view, viewAfter)).toBe(afterImage);
    const chip = view.spans[0]!;
    expect(viewToTextOffset(view, chip.viewStart + 2)).toBe(chip.start);
  });
  it("选区不能落在芯片里：光标贴近的一边，选区整个包住", () => {
    const chip = view.spans[0]!;
    expect(snapSelection(view, chip.viewStart + 1, chip.viewStart + 1)).toEqual([chip.viewStart, chip.viewStart]);
    expect(snapSelection(view, chip.viewEnd - 1, chip.viewEnd - 1)).toEqual([chip.viewEnd, chip.viewEnd]);
    expect(snapSelection(view, chip.viewStart + 1, chip.viewEnd - 1)).toEqual([chip.viewStart, chip.viewEnd]);
    expect(snapSelection(view, 0, 1)).toEqual([0, 1]);
  });
  it("Backspace / Delete 看光标紧贴哪个芯片", () => {
    const chip = view.spans[0]!;
    expect(chipTouching(view, chip.viewEnd, "before")).toBe(chip);
    expect(chipTouching(view, chip.viewStart, "after")).toBe(chip);
    expect(chipTouching(view, chip.viewEnd, "after")).toBeNull();
  });
});

describe("文件附件", () => {
  const file = (name: string, id = name) => ({ id, name, size: 2048 });
  it("在光标处插入 [File #N, 名字]，和图片各自按位置编号；名字里的 ] 和换行换成 _", () => {
    const withImage = insertImages(EMPTY_DRAFT, [image(8, 6)], 0).draft;
    const inserted = insertFiles(withImage, [file("a].txt"), file("b.md")], withImage.text.length);
    expect(inserted.draft.text).toBe("[Image #1, 8x6] [File #1, a_.txt] [File #2, b.md] ");
    expect(inserted.draft.files).toHaveLength(2);
  });
  it("删掉文字里的 [File #N] 占位符，文件跟着没了，后面的往前补号；图片不受影响", () => {
    const draft = draftOf({
      text: "[Image #1, 8x6] [File #1, a.txt] x [File #2, b.txt]",
      images: [image(8, 6)],
      files: [file("a.txt"), file("b.txt")],
    });
    const removed = removeAttachment(draft, "file", 1);
    expect(removed.files.map((entry) => entry.name)).toEqual(["b.txt"]);
    expect(removed.text).toBe("[Image #1, 8x6] x [File #1, b.txt]");
    expect(removed.images).toHaveLength(1);
  });
  it("发送：文件占位符换成 fileSlot(重排后的编号)，没引用的文件不发；显示用的文字里是 @名字，不暴露路径", () => {
    const draft = draftOf({
      text: "对比 [File #2, b.txt] 和 [File #1, a.txt]",
      files: [file("a.txt"), file("b.txt"), file("c.txt")],
    });
    const submission = buildSubmission(draft);
    expect(submission.files.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(submission.text).toBe("对比 \uE000file:2\uE001 和 \uE000file:1\uE001");
    expect(slotsToNames(submission.text, submission.files)).toBe("对比 @b.txt 和 @a.txt");
  });
  it("粘贴原文里长得像 [File #1] 的字不算引用；输入历史去掉文件占位符", () => {
    const draft = draftOf({
      text: "[Paste #1, +12 lines] [File #1, a.txt]",
      pastes: { 1: `${lines(11)}\n[File #1, fake]` },
      pasteCounter: 1,
      files: [file("a.txt")],
    });
    const submission = buildSubmission(draft);
    expect(submission.files).toHaveLength(1);
    expect(submission.text.startsWith(lines(11))).toBe(true);
    expect(historyText(draft)).toBe(`${lines(11)}\n[File #1, fake]`);
  });
  it("芯片：显示 #N 名字（长名字截断），转回来和占位符一致；拼接草稿时文件编号顺延", () => {
    const draft = draftOf({
      text: "x [File #1, 一个很长很长很长很长的文件名.txt]",
      files: [file("一个很长很长很长很长的文件名.txt")],
    });
    const view = buildView(draft, labels);
    expect(view.text).toContain("#1\u00a0一个很长很长很长很长的文件名…".slice(0, 6));
    expect(viewToText(view.text, draft)).toBe(draft.text);
    const merged = appendDraft(draft, draftOf({ text: "[File #1, z.txt]", files: [file("z.txt")] }));
    expect(merged.text).toBe("x [File #1, 一个很长很长很长很长的文件名.txt]\n\n[File #2, z.txt]");
    expect(merged.files).toHaveLength(2);
  });
  it("大小：B / KB / MB", () => {
    expect([formatFileSize(812), formatFileSize(34 * 1024), formatFileSize(1.5 * 1024 * 1024)]).toEqual([
      "812 B",
      "34 KB",
      "1.5 MB",
    ]);
  });
});

describe("输入框高度", () => {
  it("下限是一行，上限是主区的 60%；主区很矮时下限优先", () => {
    expect(maxFieldHeight(500, 27)).toBe(300);
    expect(maxFieldHeight(30, 27)).toBe(27);
    expect(clampFieldHeight(10, 27, 300)).toBe(27);
    expect(clampFieldHeight(999, 27, 300)).toBe(300);
    expect(clampFieldHeight(120.4, 27, 300)).toBe(120);
  });
});
