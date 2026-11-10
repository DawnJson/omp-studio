// `shell` 节点 → 要画的行（shell-view.ts），逐帧回放真实录制 fixtures/tsp/shell-bash.jsonl（omp 18.18.6，hello 声明了
// button / shell，yolo 下四次 bash：curl 管道 + && 链、会失败的管道、跑 3 秒的 for 循环、python -c 内联脚本 + export；
// 跑完后对每张卡片发 action shell-viz view:raw / view:pseudo，for 和 python 两张再发 expand:<折叠块>）。
// 另外核对 button-approval / button-ask 两份录制里按钮是 `button` 节点。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type DocNode, type TspDocument } from "../src/shared/tsp/document.ts";
import { shellView, type ShellView } from "../src/renderer/src/features/tsp/shell-view.ts";
import { loadTspFixture, type TspRecordLine } from "./tsp-fixtures.ts";

interface Step {
  /** 刚应用了录制里第几行（out）；in 行不产生步。 */
  index: number;
  doc: TspDocument;
  /** 这一步之前最近一个用户事件（action），没有为 null。 */
  lastEvent: Record<string, unknown> | null;
}

/** 逐条回放，每条 out 消息后给出文档（同一个对象，回调里当场读）。 */
function* replay(lines: readonly TspRecordLine[]): Generator<Step> {
  const doc = createDocument();
  let lastEvent: Record<string, unknown> | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.dir === "in") {
      const body = line.body as Record<string, unknown>;
      if (body["ev"] === "action") lastEvent = body;
      continue;
    }
    if (line.verb === "o" || line.verb === "f" || line.verb === "x")
      applyMessage(doc, { verb: line.verb, body: line.body } as Parameters<typeof applyMessage>[1]);
    yield { index, doc, lastEvent };
  }
}

const node = (doc: TspDocument, id: string): DocNode | undefined => doc.surfaces.get("s:1")?.nodes.get(id);
const text = (view: ShellView, line: number) => view.lines[line]!.pieces.map((piece) => piece.text).join("");

const lines = loadTspFixture("shell-bash");
/** 每张 shell 卡片每次变化后的样子（按出现顺序）。 */
const frames: { id: string; view: ShellView; running: boolean; lastEvent: Record<string, unknown> | null }[] = [];
{
  const last = new Map<string, unknown>();
  for (const { doc, lastEvent } of replay(lines)) {
    for (const n of doc.surfaces.get("s:1")?.nodes.values() ?? []) {
      if (n.k !== "shell" || last.get(n.id) === n.p) continue;
      last.set(n.id, n.p);
      const view = shellView(n.p["presentation"]);
      const presentation = n.p["presentation"] as { running?: boolean };
      if (view) frames.push({ id: n.id, view, running: presentation.running === true, lastEvent });
    }
  }
}

describe("shell-bash 录制：shell 节点画成的行", () => {
  it("bash 卡片的命令区是 shell 节点（声明了 shell），role 不变；默认 Pseudo", () => {
    const first = frames[0]!;
    expect(first.id).toBe("s.run/input");
    expect(first.view.view).toBe("pseudo");
    // 第 0 行：curl（cmd）、→（op）、‹（emb）依次出现。
    const pieces = first.view.lines[0]!.pieces;
    const at = (t: string, style: string) => pieces.findIndex((p) => p.text.trim() === t && p.style.includes(style));
    expect(at("curl", "cmd")).toBeGreaterThanOrEqual(0);
    expect(at("→", "op")).toBeGreaterThan(at("curl", "cmd"));
    expect(at("‹", "emb")).toBeGreaterThan(at("→", "op"));
    expect(pieces[at("curl", "cmd")]!.tone).toBe("fn");
    expect(text(first.view, 0)).toContain("curl -s --max-time 8 https://example.com → grep");
    // && 链的后两条是缩进一级的行。
    expect(first.view.lines.map((l) => l.depth)).toEqual([0, 1, 1]);
  });

  it("发 view:raw 之后 omp 回的那一帧：view 是 raw，一行 role raw，文字就是原命令；view:pseudo 切回来", () => {
    const raw = frames.find((f) => f.lastEvent?.["value"] === "view:raw" && f.id === f.lastEvent["id"])!;
    expect(raw.view.view).toBe("raw");
    expect(raw.view.lines).toHaveLength(1);
    expect(raw.view.lines[0]!.role).toBe("raw");
    expect(text(raw.view, 0)).toBe(
      "curl -s --max-time 8 https://example.com | grep -c html > count.txt && cat count.txt && rm -f count.txt",
    );
    const back = frames.find((f) => f.lastEvent?.["value"] === "view:pseudo" && f.id === raw.id)!;
    expect(back.view.view).toBe("pseudo");
    expect(back.view.lines).toHaveLength(3);
  });

  it("运行中的帧：只有含 active 片段的那一行标 ▶；不在执行的行整行淡化，active 片段加粗", () => {
    const running = frames.filter((f) => f.running);
    expect(running.length).toBeGreaterThan(3);
    for (const frame of running) {
      const marked = frame.view.lines.filter((l) => l.gutter === "active");
      expect(marked).toHaveLength(1);
      expect(marked[0]!.pieces.some((p) => p.strong)).toBe(true);
      for (const l of frame.view.lines.filter((l) => l.muted)) expect(l.pieces.every((p) => p.dim)).toBe(true);
    }
    // for 循环在跑 sleep 时：▶ 在 sleep 那一行，for 头和 print(i) 都淡化。
    const loop = running.find((f) => f.id === "w.run/input")!;
    expect(
      text(
        loop.view,
        loop.view.lines.findIndex((l) => l.gutter === "active"),
      ),
    ).toBe("sleep 1");
    expect(loop.view.lines[0]!.pieces.every((p) => p.dim)).toBe(true);
    // 跑完不打成功勾，也不再淡化。
    const done = frames.findLast((f) => f.id === "w.run/input" && !f.running)!;
    expect(done.view.lines.every((l) => l.gutter === null && l.pieces.every((p) => !p.dim))).toBe(true);
  });

  it("失败的管道：× 每个失败的命令只打一次（cat、grep 各一次），exit 1 是错误色的 meta", () => {
    const failed = frames.findLast((f) => f.id === "u.run/input" && f.view.view === "pseudo")!;
    const line = failed.view.lines[0]!;
    expect(line.pieces.filter((p) => p.fail).map((p) => p.text)).toEqual(["cat", "grep"]);
    expect(line.meta).toEqual({ text: "exit 1", fail: true });
    // 失败落在片段上，槽位不另打 ×。
    expect(line.gutter).toBeNull();
  });

  it("effects 图标带悬停说明；折叠块（+1 more）点了发 expand，omp 回来后展开成全文", () => {
    const curl = frames.findLast((f) => f.id === "s.run/input")!;
    expect(curl.view.lines[0]!.effects.map((e) => e.glyph)).toEqual(["⇅", "✎"]);
    expect(curl.view.lines[0]!.effects[0]!.tip).toBe("network: curl → example.com (heuristic, not a safety guarantee)");
    const before = frames.findLast((f) => f.id === "w.run/input" && f.lastEvent?.["value"] !== "expand:0:0:2")!;
    const fold = before.view.lines[0]!.pieces.find((p) => p.expand !== null)!;
    expect(fold).toMatchObject({ text: "+1 more", expand: "0:0:2", tip: "1\n2\n3" });
    const after = frames.find((f) => f.id === "w.run/input" && f.lastEvent?.["value"] === "expand:0:0:2")!;
    expect(text(after.view, 0)).toBe('for i in ["1", "2", "3"]:');
  });

  it("变量注释跟在设它的那一行后面", () => {
    const py = frames.findLast((f) => f.id === "y.run/input")!;
    const exported = py.view.lines.find((l) => l.annotations.length > 0)!;
    expect(text(py.view, py.view.lines.indexOf(exported))).toContain("export GREETING=");
    expect(exported.annotations).toEqual([
      { name: "GREETING", value: '"hello world from a very long variable value that goes on and on"' },
    ]);
  });
});

describe("button 录制（hello 声明了 button）：提问 / 审批的按钮是 button 节点", () => {
  const final = (name: string, until: (doc: TspDocument) => boolean) => {
    for (const { doc } of replay(loadTspFixture(name))) if (until(doc)) return doc;
    throw new Error("录制里没有期望的状态");
  };

  it("button-approval：Approve 是 k=button、role omp.btn，文字、快捷键都在 props 里", () => {
    const doc = final("button-approval", (d) => node(d, "t.actions/approve") !== undefined);
    expect(node(doc, "t.actions/approve")).toMatchObject({
      k: "button",
      p: { role: "omp.btn", text: "Approve", keys: ["ctrl", "enter"], actions: { click: "approve" } },
    });
  });

  it("button-ask：Submit 是 k=button、role omp.btn", () => {
    const doc = final("button-ask", (d) => node(d, "t.actions/submit") !== undefined);
    expect(node(doc, "t.actions/submit")).toMatchObject({
      k: "button",
      p: { role: "omp.btn", text: "Submit", keys: ["enter"], actions: { click: "submit" } },
    });
  });
});
