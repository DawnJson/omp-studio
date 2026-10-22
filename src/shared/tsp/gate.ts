// 提问/审批门和全屏面板（Agent Hub 等）对"输入框往哪发"的影响。纯函数，主进程和渲染进程共用。
//
// 依据是 omp 18.12.x 的实测录制（fixtures/tsp/{approval,ask,slash}.jsonl，test/tsp-gate.test.ts 逐帧验证），文档见
// docs/architecture/tsp-migration.md "审批门与输入框"：
// - 审批：审批卡（`omp.editor.ask.approval`）插进 dock、在 composer（`omp.editor`）前面，composer 的编辑器一直是
//   `sendable`。omp 文档（approval-mode.md）：有审批在等时发消息 = 拒绝所有待批的调用并把这条消息当插话，
//   所以 `send` 事件原样发给 composer 就是"拒绝并说明理由"，和 TUI 里在输入框打字再回车一样。
// - 提问：提问卡（`omp.editor.ask`）把 composer 整个换掉（`del j`），没有可发的地方。
// - 面板：全屏 surface（`mode: "screen"`，`/settings` 的录制里是 s:2）盖住会话；Agent Hub 是 inline surface 的 `layer` 里的
//   `picker`（omp 18.12.5 录制 tsp-hub-steer）。这两种开着时一律不往主会话的 composer 发（否则消息会变成对主代理的插话）。
//   Hub 里 `activate` 一个子代理进入聚焦模式后，同一个编辑器的 `send` 就是 steer 那个子代理（实测），所以聚焦模式照常能发。
// role 和 action 名是 omp 自己的，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import { isRecord } from "../type-guards.ts";
import { COMPOSER_ROLE } from "./composer-state.ts";
import { findNode, nodeRole, type DocNode, type TspDocument } from "./document.ts";
import { deriveTaskStatus } from "./task-status.ts";

/** 主进程为"在等用户"合成的门（TaskState.dialogs）的 id：审批和提问分开，输入框按它区分。 */
export const TSP_ASK_DIALOG_ID = "tsp-ask";
export const TSP_APPROVAL_DIALOG_ID = "tsp-approval";

/** 审批卡按钮（role `omp.btn`）的 click 动作名。 */
export const GATE_ACTION_DETAILS = "expand";
export const GATE_ACTION_DENY = "deny";
export const GATE_ACTION_APPROVE = "approve";

/**
 * 审批卡底栏的 Deny / Approve 按钮和上面选项列表里的 Approve / Deny 是同一件事，studio 不画这两个按钮（2026-10-22 仓库所有者：
 * "右下角怎么是单独的"）；Details 照画（放到标题那一行）。节点仍在文档里，Ctrl+Enter 批准照样找得到它（findGateButton）。
 */
export function isApprovalDuplicateButton(node: DocNode): boolean {
  if (nodeRole(node) !== BUTTON_ROLE || !isRecord(node.p.actions)) return false;
  const click = node.p.actions.click;
  return click === GATE_ACTION_APPROVE || click === GATE_ACTION_DENY;
}

/**
 * 面板开着时往 omp 发消息的 reject 消息（IPC 只带得过 message，渲染进程按 `screen_open` 识别后给文案）。
 */
export const TSP_SCREEN_OPEN = "screen_open: an omp panel (such as the Agent Hub) is open; close it before sending";

const BUTTON_ROLE = "omp.btn";

export type TspMessageTarget =
  /** 可以发：`send` 事件的目标。`approval` = 有审批在等，这条消息会拒绝它。 */
  | { kind: "ready"; sf: string; id: string; approval: boolean }
  /** 提问把输入框换掉了。 */
  | { kind: "ask" }
  /** 有全屏面板或 Agent Hub 选择器开着。 */
  | { kind: "panel" }
  /** 输入框还没出现（启动中）。 */
  | { kind: "pending" };

/** 有没有还活着的全屏 surface（`mode: "screen"`，没收到 `x`）。 */
export function hasLiveScreen(doc: TspDocument): boolean {
  for (const sf of doc.live) {
    if (doc.surfaces.get(sf)?.mode === "screen") return true;
  }
  return false;
}

/**
 * Agent Hub 的列表：`layer` 里的 `picker`，`tabs` 里有 `agents` 页（omp 18.12.5 实测，`action agents.open` / `/hub` 打开，标题 "Agents"）。
 * 它开着时输入框不是发送目标；`activate` 一个子代理后 Hub 关掉、omp 进入聚焦模式（dock 里 `omp.composer.focus`），
 * 这时往同一个编辑器 `send` 就是 steer 那个子代理（实测），不需要特别处理。
 */
function hasAgentHub(doc: TspDocument): boolean {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const hub = findNode(
      surface,
      (node) =>
        node.k === "picker" &&
        Array.isArray(node.p.tabs) &&
        node.p.tabs.some((tab: unknown) => isRecord(tab) && tab.id === "agents"),
      "layer",
    );
    if (hub) return true;
  }
  return false;
}

/** 有 omp 的面板盖在会话上（全屏 surface 或 Agent Hub），这时往主会话的输入框发话会变成对主代理的插话。 */
export function hasBlockingPanel(doc: TspDocument): boolean {
  return hasLiveScreen(doc) || hasAgentHub(doc);
}

/** 发一句话该往哪发；见文件头。 */
export function findMessageTarget(doc: TspDocument): TspMessageTarget {
  if (hasBlockingPanel(doc)) return { kind: "panel" };
  const ask = deriveTaskStatus(doc).ask;
  if (ask !== null && !ask.approval) return { kind: "ask" };
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const card = findNode(surface, (node) => nodeRole(node) === COMPOSER_ROLE, "dock");
    if (!card) continue;
    const editor = findNode(surface, (node) => node.k === "editor" && node.p.sendable === true, card.id);
    if (editor) return { kind: "ready", sf, id: editor.id, approval: ask !== null };
  }
  return { kind: "pending" };
}

/** 审批/提问卡上点击动作为 `act` 的按钮（给 `action` 事件用）；没有门或没有这个按钮为 null。 */
export function findGateButton(doc: TspDocument, act: string): { sf: string; id: string } | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const gate = findNode(surface, (node) => nodeRole(node)?.startsWith("omp.editor.ask") === true, "dock");
    if (!gate) continue;
    const button = findNode(
      surface,
      (node) => nodeRole(node) === BUTTON_ROLE && isRecord(node.p.actions) && node.p.actions.click === act,
      gate.id,
    );
    if (button) return { sf, id: button.id };
  }
  return null;
}
