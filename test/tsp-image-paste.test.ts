// 带图片的消息在 omp 输入框里的重建步骤，和"omp 挂上了几张图"（omp 18.12.6 实录 fixtures/tsp/image-attach.jsonl）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { imagePasteKeys, imagePasteParts, pendingImageCount } from "../src/shared/tsp/image-paste.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

describe("imagePasteParts", () => {
  it("图片粘在它在文字里的位置；omp 的占位自带尾随空格，所以后面那段开头的一个空格去掉", () => {
    expect(imagePasteParts("对比 [Image #1, 40x30] 和 [Image #2, 8x6]  两张", 2)).toEqual([
      { kind: "text", text: "对比 " },
      { kind: "image", index: 0 },
      { kind: "text", text: "和 " },
      { kind: "image", index: 1 },
      { kind: "text", text: " 两张" },
    ]);
  });

  it("编号顺序照文字里出现的先后；没有尺寸的占位符（队列撤回的）也认", () => {
    expect(imagePasteParts("[Image #2] 比 [Image #1]", 2)).toEqual([
      { kind: "image", index: 1 },
      { kind: "text", text: "比 " },
      { kind: "image", index: 0 },
    ]);
  });

  it("编号超出图片数的占位符是普通文字；没被引用的图片接在最后；只有图片也行", () => {
    expect(imagePasteParts("看 [Image #3] 这个", 1)).toEqual([
      { kind: "text", text: "看 [Image #3] 这个" },
      { kind: "image", index: 0 },
    ]);
    expect(imagePasteParts("", 2)).toEqual([
      { kind: "image", index: 0 },
      { kind: "image", index: 1 },
    ]);
  });
});

describe("imagePasteKeys", () => {
  it("一次括号粘贴一个带引号的路径，反斜杠换成正斜杠（omp 把 `\\(` 当转义）", () => {
    expect(imagePasteKeys("C:\\Users\\some one\\(x)\\1.png")).toBe('\x1b[200~"C:/Users/some one/(x)/1.png"\x1b[201~');
  });
});

describe("pendingImageCount", () => {
  it("实录：粘贴后输入框上方挂一张图，提交后 omp 清掉；图片进了用户消息，不算待发送", () => {
    const lines = loadTspFixture("image-attach");
    const submitAt = recordedUserEvents(lines).find(({ event }) => event["ev"] === "action")!.t;
    const doc = createDocument();
    const counts: number[] = [];
    let beforeSubmit = 0;
    for (const { t, message } of tspDocMessages(lines)) {
      applyMessage(doc, message);
      counts.push(pendingImageCount(doc));
      if (t <= submitAt) beforeSubmit = pendingImageCount(doc);
    }
    expect(counts[0]).toBe(0);
    expect(beforeSubmit).toBe(1);
    expect(counts.at(-1)).toBe(0);
  });
});
