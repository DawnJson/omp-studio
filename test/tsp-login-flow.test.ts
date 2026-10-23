// `/login <provider>` 在 TSP 里的流程判断（src/shared/tsp/login-flow.ts）：用 omp 18.12.6 的真实录制逐帧回放，看每一步的状态。
// 录制（2026-10-23，临时 agent 目录、没有真实账号，设备码已换成示例）：
//   login-github-copilot：`/login github-copilot` → 企业域名输入 → Continue → 设备码页 → 用户点 Cancel（omp 自己的按钮）。
//   login-failed：同样走到 Continue，但网络被代理拒绝（HTTPS_PROXY 指向关闭的端口）→ "Error: Login failed: ECONNREFUSED…"。
// 成功没有真实账号可录：用失败录制里同一位置的帧，把那行错误文字换成 omp 18.12.6 源码里 present 的成功文字（selector-controller.ts）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocMessage } from "../src/shared/tsp/document.ts";
import { deriveLoginFlow, type LoginFlowState } from "../src/shared/tsp/login-flow.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 回放一份录制，返回每条消息之后的流程状态（连续相同的合并）。 */
function timeline(messages: readonly TspDocMessage[]): LoginFlowState[] {
  const doc = createDocument();
  const states: LoginFlowState[] = [];
  for (const message of messages) {
    applyMessage(doc, message);
    const state = deriveLoginFlow(doc);
    const last = states.at(-1);
    if (last === undefined || JSON.stringify(last) !== JSON.stringify(state)) states.push(state);
  }
  return states;
}

const messagesOf = (name: string): TspDocMessage[] =>
  tspDocMessages(loadTspFixture(name)).map((entry) => entry.message);

describe("deriveLoginFlow", () => {
  it("取消：登录窗开着是 running，用户点 omp 的 Cancel 后（toast 变成 Login cancelled、窗口被删）是 cancelled", () => {
    expect(timeline(messagesOf("login-github-copilot")).map((state) => state.kind)).toEqual([
      "idle",
      "running",
      "cancelled",
    ]);
  });

  it("失败：窗口被删的同一帧里多一行 Error: Login failed，原因原样带出", () => {
    const states = timeline(messagesOf("login-failed"));
    expect(states.map((state) => state.kind)).toEqual(["idle", "running", "failed"]);
    const failed = states.at(-1);
    expect(failed).toEqual({
      kind: "failed",
      message: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
    });
  });

  it("成功：main 里出现 Successfully logged in 的文字（成功帧没有实录，文字出自 omp 源码）", () => {
    const messages = messagesOf("login-failed");
    // 最后一条 f 帧就是结果帧：把它的错误文字换成成功文字，其余（删登录窗、恢复输入框）原样。
    const last = messages.at(-1);
    if (last?.verb !== "f") throw new Error("the last recorded message should be the result frame");
    const ops = last.body.ops.map((op) =>
      op[0] === "add" && op[4].k === "text"
        ? ([
            "add",
            op[1],
            op[2],
            op[3],
            {
              ...op[4],
              p: { wrap: "word", spans: [{ t: "✔ Successfully logged in to github-copilot", s: "success" }] },
            },
          ] as typeof op)
        : op,
    );
    const states = timeline([...messages.slice(0, -1), { verb: "f", body: { ...last.body, ops } }]);
    expect(states.map((state) => state.kind)).toEqual(["idle", "running", "success"]);
  });

  it("带账号名的成功文字也认", () => {
    const doc = createDocument();
    applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline" } });
    applyMessage(doc, {
      verb: "f",
      body: {
        sf: "s:1",
        s: 1,
        ops: [
          ["add", "main", "s:1", null, { id: "main", k: "col" }],
          [
            "add",
            "ok",
            "main",
            null,
            {
              id: "ok",
              k: "text",
              p: { spans: [{ t: "ok Successfully logged in to perplexity as a@b.c", s: "success" }] },
            },
          ],
        ],
      },
    });
    expect(deriveLoginFlow(doc)).toEqual({ kind: "success" });
  });

  it("没有任何登录内容的文档是 idle", () => {
    expect(deriveLoginFlow(createDocument())).toEqual({ kind: "idle" });
  });
});
