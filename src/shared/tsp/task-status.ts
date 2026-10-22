// 从 TSP 文档推任务状态（侧栏的点、托盘、系统通知）。纯函数，主进程每应用一帧调用一次。
//
// 依据是 omp 18.12.3 的实测录制（fixtures/tsp/{task,approval,ask}.jsonl，test/tsp-task-status.test.ts 逐帧验证）：
// - 输入框区域（`dock`）里有 role 以 `omp.editor.ask` 开头的节点 = 在等用户：提问是 `omp.editor.ask`，工具审批是
//   `omp.editor.ask.approval`。提问时 composer 被换掉；审批时 composer（`omp.editor`）留在文档里，审批卡插在它前面
//   （approval.jsonl 第 33 帧，没有 `del j`）。两种情况 `omp.working` 那一行都仍在（任务其实还没跑完）。
// - `dock` 里有 `omp.working`（运行状态行，含 `omp.working.stop`）或 composer 的停止按钮 `omp.composer.stop` = 在跑：
//   发出消息的那一帧出现，这一轮结束的那一帧消失。主区里的 spinner 不可靠（子代理、后台任务的卡片停在 running 时
//   主回合已经结束），`omp.hud.activity`（待办面板）也会在回合结束后继续显示，都不用。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import { findNode, nodeRole, plainText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

export type TspTaskStatus = "running" | "needs_you" | "idle";

export interface TspStatusInfo {
  status: TspTaskStatus;
  /** 有运行中的迹象（needs_you 时通常也是 true：提问和审批发生在一轮的中间）。 */
  working: boolean;
  /** 在等用户时，问题或审批标题的第一行；节点里找不到文字时为空串。没有等待为 null。 */
  ask: { title: string; approval: boolean } | null;
}

const ASK_ROLE_PREFIX = "omp.editor.ask";
const APPROVAL_ROLE = "omp.editor.ask.approval";
const WORKING_ROLES: ReadonlySet<string> = new Set(["omp.working", "omp.working.stop", "omp.composer.stop"]);
/** 提问的问题 `md`、审批的标题 `text`。 */
const ASK_TITLE_ROLES: ReadonlySet<string> = new Set(["omp.ask.question", "omp.approval.title"]);

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

function askTitle(surface: DocSurface, ask: DocNode): string {
  const titled = findNode(surface, (node) => ASK_TITLE_ROLES.has(nodeRole(node) ?? ""), ask.id);
  const node = titled ?? findNode(surface, (candidate) => plainText(candidate).trim() !== "", ask.id);
  return node ? firstLine(plainText(node)) : "";
}

export function deriveTaskStatus(doc: TspDocument): TspStatusInfo {
  let working = false;
  let ask: { title: string; approval: boolean } | null = null;
  for (const id of doc.live) {
    const surface = doc.surfaces.get(id);
    if (!surface?.nodes.has("dock")) continue;
    if (ask === null) {
      const node = findNode(surface, (candidate) => nodeRole(candidate)?.startsWith(ASK_ROLE_PREFIX) === true, "dock");
      if (node) ask = { title: askTitle(surface, node), approval: nodeRole(node) === APPROVAL_ROLE };
    }
    if (!working)
      working = findNode(surface, (candidate) => WORKING_ROLES.has(nodeRole(candidate) ?? ""), "dock") !== null;
  }
  return { status: ask ? "needs_you" : working ? "running" : "idle", working, ask };
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
