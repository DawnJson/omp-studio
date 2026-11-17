import { describe, expect, it } from "vitest";
import {
  applyMessage,
  createDocument,
  findNode,
  nodeRole,
  treeNodes,
  type TspDocument,
} from "../src/shared/tsp/document.ts";
import { focusedAgentName } from "../src/shared/tsp/agent-hub.ts";
import { findMessageTarget } from "../src/shared/tsp/gate.ts";
import { pendingImageCount } from "../src/shared/tsp/image-paste.ts";
import { hasQueuedMessages } from "../src/shared/tsp/queue-restore.ts";
import { queuedSubmitTarget } from "../src/shared/tsp/queue-submit.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function queuedDocument(): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture("queue-follow-up-esc"))) {
    applyMessage(doc, message);
    if (hasQueuedMessages(doc)) return doc;
  }
  throw new Error("fixture has no queued message");
}

describe("立即处理队列的空提交目标", () => {
  it("只对有队列的主会话空输入框提交，不拿队列文字重发", () => {
    expect(queuedSubmitTarget(queuedDocument())).toEqual({ sf: "s:1", id: "j.line/input" });
    expect(queuedSubmitTarget(createDocument())).toBeNull();
  });

  it("omp 输入框里尚有草稿时不提交，避免把取回或未发出的内容一起发走", () => {
    const doc = queuedDocument();
    const surface = doc.surfaces.get("s:1")!;
    const editor = surface.nodes.get("j.line/input")!;
    surface.nodes.set(editor.id, { ...editor, p: { ...editor.p, text: "unsent draft" } });
    expect(queuedSubmitTarget(doc)).toBeNull();
  });

  it("审批、提问、全屏和聚焦子代理不能触发主队列中断", () => {
    for (const name of ["approval", "ask", "slash", "hub-steer", "queue-edit-image"]) {
      const doc = createDocument();
      let checked = false;
      for (const { message } of tspDocMessages(loadTspFixture(name))) {
        applyMessage(doc, message);
        const target = findMessageTarget(doc);
        const blocked =
          name === "approval"
            ? target.kind === "ready" && target.approval
            : name === "ask"
              ? target.kind === "ask"
              : name === "slash"
                ? target.kind === "panel"
                : name === "hub-steer"
                  ? focusedAgentName(doc) !== null
                  : pendingImageCount(doc) > 0;
        if (!blocked) continue;
        const source = queuedDocument().surfaces.get("s:1")!;
        const queue = findNode(source, (node) => nodeRole(node) === "omp.queue", "dock")!;
        const surface = doc.surfaces.get("s:1")!;
        const dock = surface.nodes.get("dock")!;
        for (const node of treeNodes(source, queue.id)) surface.nodes.set(node.id, node);
        surface.nodes.set(dock.id, { ...dock, c: [...dock.c, queue.id] });
        expect(hasQueuedMessages(doc)).toBe(true);
        expect(queuedSubmitTarget(doc)).toBeNull();
        checked = true;
        break;
      }
      expect(checked, name).toBe(true);
    }
  });
});
