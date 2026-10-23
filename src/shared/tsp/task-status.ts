// 从 TSP 文档和 omp 的 OSC 7501 推任务状态（侧栏的点、托盘、系统通知）。纯函数，主进程每应用一帧、每收到一条 7501 调用一次。
//
// 两路信号（docs/architecture/tsp-migration.md §7）：
// - OSC 7501（run-status.ts）是主信号：working → 在跑，blocked → 在等用户，done / idle / error 给这一轮的结局。
//   omp 18.12.6 只在一轮开始、工具开始 / 结束、一轮结束时发，所以它不覆盖：交接、建 worktree、分支摘要、压缩这类
//   "没有 agent 一轮但 omp 在忙"的状态（dock 里的 `omp.loader`），也不覆盖等用户操作的模态弹窗。这两类由节点补判断。
//   没收到过 7501 的会话（用户关了 `terminal.programStatus`）整个退回节点推导。
// - 节点推导的依据是 omp 18.12.3 的实测录制（fixtures/tsp/{task,approval,ask}.jsonl，test/tsp-task-status.test.ts 逐帧验证）：
//   - 输入框区域（`dock`）里有 role 以 `omp.editor.ask` 开头的节点 = 在等用户：提问是 `omp.editor.ask`，工具审批是
//     `omp.editor.ask.approval`。提问时 composer 被换掉；审批时 composer（`omp.editor`）留在文档里，审批卡插在它前面
//     （approval.jsonl 第 33 帧，没有 `del j`）。两种情况 `omp.working` 那一行都仍在（任务其实还没跑完）。
//   - `dock` 里有 `omp.working`（运行状态行，含 `omp.working.stop`）或 composer 的停止按钮 `omp.composer.stop` = 在跑：
//     发出消息的那一帧出现，这一轮结束的那一帧消失。主区里的 spinner 不可靠（子代理、后台任务的卡片停在 running 时
//     主回合已经结束），`omp.hud.activity`（待办面板）也会在回合结束后继续显示，都不用。
//   - `omp.hud.activity` 里的 `omp.loader`（旋转图标 + 文字）= 在忙（session-tree-summarize.jsonl 第 16 帧：分支摘要）。
//   - `omp.overlay.hook-select / hook-input / hook-editor / planReview / planSave / login`（dock 或 layer 里的模态：扩展或 omp 要用户选 / 输入 / 审阅 / 登录）= 在等用户。
//     studio 自己驱动打开的弹窗（`/jobs` `omp.overlay.jobs`、context 报告 `omp.overlay.report`、Agent Hub、旁路提问 `omp.overlay.btwHistory`、
//     会话树）不在这个名单里：它们是 studio 的界面在操作，不算"等你"。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import { stripIconGlyphs } from "../ui/clean-title.ts";
import { findNode, nodeRole, plainText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";
import { blockedOpen, type RunSignal } from "./run-status.ts";

export type TspTaskStatus = "running" | "needs_you" | "idle";

/** 在等用户：审批和提问分开（输入框按它区分），modal 是 omp 的模态弹窗。 */
export type TspWaitKind = "question" | "approval" | "modal";

export interface TspStatusInfo {
  status: TspTaskStatus;
  /** 有运行中的迹象（needs_you 时通常也是 true：提问和审批发生在一轮的中间）；含 `omp.loader`。 */
  working: boolean;
  /** 在等用户时，问题或审批标题的第一行；节点里找不到文字时为空串。没有等待为 null。只含输入框里的门（提问、审批）。 */
  ask: { title: string; approval: boolean } | null;
  /** dock 里 `omp.hud.activity` 下 `omp.loader` 的文字（没有文字时为空串）；没有 loader 为 null。 */
  loader: string | null;
  /** 在等用户的模态弹窗（`omp.overlay.hook-*` 等）的标题；没有为 null。 */
  modal: { title: string } | null;
}

const ASK_ROLE_PREFIX = "omp.editor.ask";
const APPROVAL_ROLE = "omp.editor.ask.approval";
const WORKING_ROLES: ReadonlySet<string> = new Set(["omp.working", "omp.working.stop", "omp.composer.stop"]);
/** 提问的问题 `md`、审批的标题 `text`。 */
const ASK_TITLE_ROLES: ReadonlySet<string> = new Set(["omp.ask.question", "omp.approval.title"]);
const ACTIVITY_ROLE = "omp.hud.activity";
const LOADER_ROLE = "omp.loader";
/** 等用户操作的模态弹窗（omp 源码 packages/tui/src/overlays/ 里 `super(title, "omp.overlay.*")`、plan-review-overlay、plan-save-overlay）。 */
const MODAL_ROLES: ReadonlySet<string> = new Set([
  "omp.overlay.hook-select",
  "omp.overlay.hook-input",
  "omp.overlay.hook-editor",
  "omp.overlay.planReview",
  "omp.overlay.planSave",
]);
const LOGIN_ROLE_PREFIX = "omp.overlay.login";

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

function askTitle(surface: DocSurface, ask: DocNode): string {
  const titled = findNode(surface, (node) => ASK_TITLE_ROLES.has(nodeRole(node) ?? ""), ask.id);
  const node = titled ?? findNode(surface, (candidate) => plainText(candidate).trim() !== "", ask.id);
  return node ? firstLine(plainText(node)) : "";
}

/** 弹窗的标题：根节点的 `head`（原生 overlay：planReview、planSave），否则里面第一段有文字的节点（hook 系列的标题行）。 */
function modalTitle(surface: DocSurface, modal: DocNode): string {
  const head = modal.p["head"];
  if (typeof head === "string" && head.trim() !== "") return firstLine(head);
  const node = findNode(surface, (candidate) => plainText(candidate).trim() !== "", modal.id);
  return node ? firstLine(plainText(node)) : "";
}

function loaderText(surface: DocSurface): string | null {
  const activity = findNode(surface, (node) => nodeRole(node) === ACTIVITY_ROLE, "dock");
  if (!activity) return null;
  const loader = findNode(surface, (node) => nodeRole(node) === LOADER_ROLE, activity.id);
  if (!loader) return null;
  const inner = findNode(surface, (node) => node.k === "text" && plainText(node).trim() !== "", loader.id);
  return inner ? firstLine(stripIconGlyphs(plainText(inner))) : "";
}

/** 只看节点：没有 7501 时的推导，也是 7501 之外要补的两类（loader、模态弹窗）。 */
export function deriveTaskStatus(doc: TspDocument): TspStatusInfo {
  let working = false;
  let ask: { title: string; approval: boolean } | null = null;
  let loader: string | null = null;
  let modal: { title: string } | null = null;
  for (const id of doc.live) {
    const surface = doc.surfaces.get(id);
    if (!surface) continue;
    if (modal === null) {
      for (const region of ["dock", "layer"]) {
        if (!surface.nodes.has(region)) continue;
        const node = findNode(
          surface,
          (candidate) => {
            const role = nodeRole(candidate);
            return role !== null && (MODAL_ROLES.has(role) || role.startsWith(LOGIN_ROLE_PREFIX));
          },
          region,
        );
        if (node) {
          modal = { title: modalTitle(surface, node) };
          break;
        }
      }
    }
    if (!surface.nodes.has("dock")) continue;
    if (ask === null) {
      const node = findNode(surface, (candidate) => nodeRole(candidate)?.startsWith(ASK_ROLE_PREFIX) === true, "dock");
      if (node) ask = { title: askTitle(surface, node), approval: nodeRole(node) === APPROVAL_ROLE };
    }
    if (loader === null) loader = loaderText(surface);
    if (!working)
      working = findNode(surface, (candidate) => WORKING_ROLES.has(nodeRole(candidate) ?? ""), "dock") !== null;
  }
  working ||= loader !== null;
  return { status: ask || modal ? "needs_you" : working ? "running" : "idle", working, ask, loader, modal };
}

export interface ResolvedStatus {
  status: TspTaskStatus;
  working: boolean;
  /** 在等什么（title 可能为空串）；没有为 null。门节点优先于 7501 的文字：节点是输入框里真实的门。 */
  waiting: { kind: TspWaitKind; title: string } | null;
}

/**
 * 节点推导和 7501 合起来的状态。
 * - 在跑：7501 说 working / blocked，或节点有运行状态行 / loader。取并集：压缩、交接这类 7501 不报的运行靠节点，
 *   一轮的开始靠 7501（不用等 `omp.working` 那一帧）；结束要两边都说结束。
 * - 在等用户：输入框的门节点，或 7501 的 blocked（门节点比它晚几毫秒到，见 `blockedOpen`），或模态弹窗。
 */
export function resolveTaskStatus(nodes: TspStatusInfo, signal: RunSignal): ResolvedStatus {
  const blocked = blockedOpen(signal, nodes.ask !== null);
  const working = nodes.working || (signal.seen && (signal.state === "working" || signal.state === "blocked"));
  const waiting: ResolvedStatus["waiting"] = nodes.ask
    ? { kind: nodes.ask.approval ? "approval" : "question", title: nodes.ask.title }
    : blocked
      ? { kind: signal.kind === "permission" ? "approval" : "question", title: firstLine(signal.msg ?? "") }
      : nodes.modal
        ? { kind: "modal", title: nodes.modal.title }
        : null;
  return { status: waiting ? "needs_you" : working ? "running" : "idle", working, waiting };
}

/**
 * 有没有还没结束的工具或子代理卡片（`tool` / `agent` 的 status 是 pending 或 running）。回合结束后它们都是 done
 * （task.jsonl 的最后一帧）；转到后台的任务会让卡片继续 running，这时进程不能被回收，回收会把它杀掉。
 */
export function hasRunningWork(doc: TspDocument): boolean {
  for (const id of doc.live) {
    const surface = doc.surfaces.get(id);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if ((node.k === "tool" || node.k === "agent") && (node.p.status === "pending" || node.p.status === "running"))
        return true;
    }
  }
  return false;
}
