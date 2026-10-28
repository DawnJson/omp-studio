// 主进程推给渲染进程的 TSP 批次（main/tasks/tsp-feed.ts）：只推有镜像的任务、释放后不再推、blob 只带 id，
// 窗口藏着时不推、出来后补的空批次让渲染进程重拉快照（tsp-sync.ts），藏着期间 getTspSeq 给的是已推出去的序号。
// 消息用 omp 18.12.6 的实录 fixtures/tsp/image-attach.jsonl（带一张粘贴的图片）。
import { describe, expect, it } from "vitest";
import type { TaskId, TspFeedBatch } from "../src/shared/ipc.ts";
import {
  applyMessage,
  createDocument,
  restoreDocument,
  reuseUnchangedNodes,
  snapshotDocument,
  type TspDocMessage,
  type TspDocument,
} from "../src/shared/tsp/document.ts";
import { TspFeed } from "../src/main/tasks/tsp-feed.ts";
import { planTspBatch } from "../src/renderer/src/features/tsp/tsp-sync.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

const messages: TspDocMessage[] = tspDocMessages(loadTspFixture("image-attach")).map((entry) => entry.message);
const blobMessage = messages.find((message) => message.verb === "b");
if (blobMessage?.verb !== "b") throw new Error("image-attach has no blob");
/** 图片之后的那条消息的下标：先推到这里（含图片），剩下的留给后面的步骤。 */
const afterBlob = messages.indexOf(blobMessage) + 1;

/** 主进程那边：一份文档 + 序号，每条消息一批经 TspFeed 推出去（同 TspSession → TspRunner → runtime.ts）。 */
class FakeMain {
  readonly doc: TspDocument = createDocument();
  seq = 0;
  readonly feed: TspFeed;
  constructor(emit: (batch: TspFeedBatch) => void) {
    this.feed = new TspFeed(emit);
  }
  push(taskId: TaskId, from: number, to: number): void {
    for (const message of messages.slice(from, to)) {
      applyMessage(this.doc, message);
      this.seq += 1;
      this.feed.push({ taskId, firstSeq: this.seq, messages: [message] });
    }
  }
}

describe("TspFeed", () => {
  it("只推有镜像的任务；blob 消息只带 id，不带 base64", () => {
    const sent: TspFeedBatch[] = [];
    const main = new FakeMain((batch) => sent.push(batch));
    const task = "t-feed" as TaskId;
    main.push(task, 0, 3);
    expect(sent).toEqual([]);
    main.feed.mirror(task);
    main.push(task, 3, afterBlob);
    expect(sent.map((batch) => batch.firstSeq)).toEqual(Array.from({ length: afterBlob - 3 }, (_, i) => i + 4));
    expect(sent.flatMap((batch) => batch.messages).find((message) => message.verb === "b")).toEqual({
      verb: "b",
      id: blobMessage.id,
    });
    expect(JSON.stringify(sent)).not.toContain(blobMessage.data);
    main.feed.release(task);
    main.push(task, afterBlob, messages.length);
    expect(sent).toHaveLength(afterBlob - 3);
  });

  it("窗口藏着时不推；出来时补一个越过空档的空批次，渲染进程据此重拉快照；藏着期间驱动等的序号是已推出去的", () => {
    const sent: TspFeedBatch[] = [];
    const main = new FakeMain((batch) => sent.push(batch));
    const task = "t-hidden" as TaskId;
    main.feed.mirror(task);
    main.push(task, 0, 2);
    const rendererSeq = main.seq;
    main.feed.setHidden(true);
    main.push(task, 2, messages.length);
    expect(sent).toHaveLength(2);
    expect(main.feed.delivered(task, main.seq)).toBe(rendererSeq);
    main.feed.setHidden(false);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual({ taskId: task, firstSeq: main.seq + 1, messages: [] });
    expect(planTspBatch(rendererSeq, sent[2]!)).toEqual({ kind: "resync" });
    expect(main.feed.delivered(task, main.seq)).toBe(main.seq);
  });
});

describe("窗口还原 / 丢帧后重拉快照", () => {
  it("没变的节点沿用渲染进程手里的旧记录（界面不重画），变了的换新", () => {
    const main = new FakeMain(() => undefined);
    const task = "t-reuse" as TaskId;
    // IPC 是结构化克隆：渲染进程拿到的快照和主进程的记录不是同一批对象。
    const fetch = () => restoreDocument(structuredClone(snapshotDocument(main.doc)));
    main.push(task, 0, afterBlob);
    const before = fetch();
    main.push(task, afterBlob, messages.length);
    const after = fetch();
    reuseUnchangedNodes(after, before);
    let reused = 0;
    let replaced = 0;
    for (const surface of after.surfaces.values()) {
      for (const [id, node] of surface.nodes) {
        const old = before.surfaces.get(surface.id)?.nodes.get(id);
        const same = old !== undefined && JSON.stringify(old) === JSON.stringify(node);
        expect(node === old).toBe(same);
        if (same) reused += 1;
        else replaced += 1;
      }
    }
    expect(reused).toBeGreaterThan(0);
    expect(replaced).toBeGreaterThan(0);
    // 换回旧记录不改内容（还原出的文档不带 blob 表，见 restoreDocument）。
    expect({ ...snapshotDocument(after), blobIds: [] }).toEqual({ ...snapshotDocument(main.doc), blobIds: [] });
  });
});
