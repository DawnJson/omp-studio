// 子代理面板（spec §4.28）读 omp 的 TSP 文档：列表、Hub 选择器、聚焦模式。纯函数，主进程（驱动 Hub）和渲染进程（画面板）共用。
//
// 依据是 omp 18.12.5 的实测录制：
// - fixtures/tsp/hub-steer.jsonl（NativeUiPlan）：`agent` 节点在 task 工具卡片下（`<卡片id>.<名字>`，卡片 id 随转录重排变化，同一个名字可能同时有两份）；
//   `action agents.open`（hud 的 `omp.hud.seg`，`actions.click`）打开 Hub = layer 里的 `picker`（`tabs` 有 agents / activity）；
//   对 picker `activate item=<名字>` → Hub 关闭，composer 卡片里多一行 `omp.composer.focus`（`omp.composer.exit` 的 `actions.click` 是
//   `focus:Main`），之后同一个编辑器的 `send` 只写进那个子代理的会话。
// - fixtures/tsp/hub-kill.jsonl（S1Agents，真实 omp，`deepseek/deepseek-v4-flash`）：picker 的 `select` 事件把 `selected` 换成那一项；
//   底栏 actions 里 `kill`（`danger`，没有 `disabled` 字段）→ 该项 `dot` 由 `pending` 变 `error`、`revive` 的 `disabled` 去掉，
//   **没有 confirm**，只有 toast "Background task <名字> completed"；`revive`（运行中的项 `disabled: "Only parked or killed agents can be
//   revived"`）→ `dot` 变 `success`（被复活的代理空闲着）、`revive` 又被禁用；Esc 键关掉 Hub。
// role、action、dot 名都是 omp 自己的、不在 TSP 规范里：omp 改名这里就失效，所以判断全部集中在这个文件（gate.ts 同理）。
import { isRecord } from "../type-guards.ts";
import { findNode, nodeRole, spansText, type DocNode, type TspDocument } from "./document.ts";

/** hud 里 `👥` 胶囊（`omp.hud.seg`）的点击动作：打开 Agent Hub。studio 拦截它改开自己的子代理面板。 */
export const HUB_OPEN_ACTION = "agents.open";
export const HUB_ACTION_KILL = "kill";
export const HUB_ACTION_REVIVE = "revive";
/** picker 的页签动作（`action act="tab" value=<页签 id>`，和 Picker 组件点页签发的一样）。 */
export const HUB_ACTION_TAB = "tab";
export const HUB_TAB_AGENTS = "agents";
/** Hub 里的 `/hub` 命令（没有子代理在跑时 hud 里没有 `👥`，用它打开）。 */
export const HUB_SLASH = "/hub";

const FOCUS_ROLE = "omp.composer.focus";
const FOCUS_AGENT_ROLE = "omp.composer.agent";
const FOCUS_EXIT_ROLE = "omp.composer.exit";

/** 点 `👥` 这类动作：studio 不把它转给 omp。 */
export function isHubOpenAction(act: string): boolean {
  return act === HUB_OPEN_ACTION;
}

/**
 * 派子代理的 task 工具卡片（`omp.tool.task`）。omp 18.12.6 把它发成 `collapsed:true` + `preview:"none"`（只剩标题行，
 * 见 docs/architecture/subagents.md）；studio 默认展开它，让每个子代理一行（状态、用时、统计）一直看得见
 * （2026-10-22 仓库所有者）。只改起始状态：子代理行自己的折叠照 omp，点卡片头照常发 `toggle`。
 */
export function expandsByDefault(role: unknown): boolean {
  return role === "omp.tool.task";
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// ───────── 列表（`agent` 节点） ─────────

export type AgentStatus = "pending" | "running" | "done" | "failed" | "aborted" | "idle" | "parked";

export interface HubAgent {
  /** omp 给的名字（`Alpha`、`Outer-3.Inner`），也是 Hub picker 里的 item id 和会话文件名。 */
  name: string;
  /** 代理类型（`task` 等）。 */
  agent: string | null;
  /** 一句话任务说明（omp 把换行压成了空格）。 */
  task: string;
  /** 任务说明原文（带换行的 Markdown，`agent` 节点下 `omp.task.assignment` 子节点）；没有时为 null。 */
  assignment: string | null;
  status: AgentStatus;
  model: string | null;
  tool: { name: string; intent: string; age: number | null } | null;
  stats: {
    tools: number | null;
    requests: number | null;
    tokens: number | null;
    contextLabel: string | null;
    cost: number | null;
    /** 运行中的已用毫秒 / 结束的总用时。 */
    age: number | null;
    took: number | null;
    /** 子代理自己估计的完成度 0–1（omp 18.12.6 起的 `task.completionProbe`：跑了 2、5、10、30 分钟后各问一次，之后每小时）；omp 只在运行中给。 */
    done: number | null;
  };
  background: boolean;
  depth: number;
}

const ASSIGNMENT_ROLE = "omp.task.assignment";
/** 还在跑的子代理所在的 task 卡片状态；卡片已经结束而子代理还写着等待/运行，是 `--resume` 重放出来的旧节点。 */
const LIVE_CARD_STATUSES: Readonly<Record<string, true>> = { pending: true, running: true };

function toAgent(node: DocNode, nodes: ReadonlyMap<string, DocNode>): HubAgent | null {
  const p = node.p;
  const name = p["name"];
  const status = p["status"];
  if (typeof name !== "string" || name === "" || typeof status !== "string" || !Object.hasOwn(LIVENESS, status))
    return null;
  const tool = isRecord(p["tool"]) && typeof p["tool"]["name"] === "string" ? p["tool"] : null;
  const stats = isRecord(p["stats"]) ? p["stats"] : {};
  const badges = Array.isArray(p["badges"]) ? p["badges"] : [];
  const assignment = node.c.map((id) => nodes.get(id)).find((child) => child && nodeRole(child) === ASSIGNMENT_ROLE);
  const card = node.parent === null ? undefined : nodes.get(node.parent);
  // 实测 omp 18.12.6：`--resume` 之后旧 task 卡片是 done，卡下的子代理却一律是 pending（用量也没了），omp 的 Hub 把它们算作 parked。
  const cardStatus = card?.p["status"];
  const stale =
    isAgentActive(status as AgentStatus) &&
    typeof cardStatus === "string" &&
    !Object.hasOwn(LIVE_CARD_STATUSES, cardStatus);
  return {
    name,
    agent: typeof p["agent"] === "string" ? p["agent"] : null,
    task: spansText(p["task"]),
    assignment: assignment && typeof assignment.p["text"] === "string" ? assignment.p["text"] : null,
    status: stale ? "parked" : (status as AgentStatus),
    model: typeof p["model"] === "string" ? p["model"] : null,
    tool: tool
      ? { name: tool["name"] as string, intent: spansText(tool["intent"]), age: finiteNumber(tool["age"]) }
      : null,
    stats: {
      tools: finiteNumber(stats["tools"]),
      requests: finiteNumber(stats["requests"]),
      tokens: finiteNumber(stats["tokens"]),
      contextLabel: typeof stats["contextLabel"] === "string" ? stats["contextLabel"] : null,
      cost: finiteNumber(stats["cost"]),
      age: finiteNumber(stats["age"]),
      took: finiteNumber(stats["took"]),
      done: finiteNumber(stats["done"]),
    },
    background: badges.some((badge: unknown) => isRecord(badge) && badge["text"] === "background"),
    depth: finiteNumber(p["depth"]) ?? 0,
  };
}

/** 同一个名字可能有两份节点：取"更活"的那份（运行中 > 等待 > 空闲/挂起 > 其它），同级取文档里更靠后的。 */
const LIVENESS: Record<AgentStatus, number> = {
  running: 5,
  pending: 4,
  idle: 3,
  parked: 3,
  done: 2,
  failed: 1,
  aborted: 1,
};

/** 文档里所有子代理（活着的 surface 里的 `agent` 节点，按名字去重），按首次出现的顺序。 */
export function listAgents(doc: TspDocument): HubAgent[] {
  const byName = new Map<string, HubAgent>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k !== "agent") continue;
      const agent = toAgent(node, surface.nodes);
      if (!agent) continue;
      const previous = byName.get(agent.name);
      if (!previous) byName.set(agent.name, agent);
      else if (LIVENESS[agent.status] >= LIVENESS[previous.status]) byName.set(agent.name, agent);
    }
  }
  return [...byName.values()];
}

/** 运行中（还没结束、也没被结束）。 */
export function isAgentActive(status: AgentStatus): boolean {
  return status === "running" || status === "pending";
}

/** 运行中的子代理个数（输入框上方药丸左半段 `👥 N`）；`listAgents` 按名字去重，同一个只算一次。 */
export function countActiveAgents(doc: TspDocument): number {
  return listAgents(doc).filter((agent) => isAgentActive(agent.status)).length;
}

// ───────── Hub 选择器 ─────────

export interface HubAction {
  id: string;
  /** omp 给的禁用原因；`true` = 禁用但没原因；undefined = 可用。 */
  disabled: string | true | undefined;
}

export interface AgentHubView {
  sf: string;
  /** picker 节点 id（`activate` / `select` / `action` 的目标）。 */
  id: string;
  tab: string | null;
  hasAgentsTab: boolean;
  selected: string | null;
  items: { id: string; dot: string | null }[];
  actions: HubAction[];
}

/** layer 里的 Agent Hub（picker，`tabs` 里有 agents 页）；没开为 null。 */
export function findAgentHub(doc: TspDocument): AgentHubView | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const node = findNode(
      surface,
      (candidate) =>
        candidate.k === "picker" &&
        Array.isArray(candidate.p["tabs"]) &&
        candidate.p["tabs"].some((tab: unknown) => isRecord(tab) && tab["id"] === HUB_TAB_AGENTS),
      "layer",
    );
    if (!node) continue;
    const items: AgentHubView["items"] = [];
    if (Array.isArray(node.p["items"])) {
      for (const item of node.p["items"] as readonly unknown[]) {
        if (isRecord(item) && typeof item["id"] === "string")
          items.push({ id: item["id"], dot: typeof item["dot"] === "string" ? item["dot"] : null });
      }
    }
    const actions: HubAction[] = [];
    if (Array.isArray(node.p["actions"])) {
      for (const action of node.p["actions"] as readonly unknown[]) {
        if (!isRecord(action) || typeof action["id"] !== "string") continue;
        const disabled = action["disabled"];
        actions.push({
          id: action["id"],
          disabled: typeof disabled === "string" || disabled === true ? disabled : undefined,
        });
      }
    }
    return {
      sf,
      id: node.id,
      tab: typeof node.p["tab"] === "string" ? node.p["tab"] : null,
      hasAgentsTab: true,
      selected: typeof node.p["selected"] === "string" ? node.p["selected"] : null,
      items,
      actions,
    };
  }
  return null;
}

export type HubActionState = { state: "ready" } | { state: "disabled"; reason: string | null } | { state: "missing" };

/** Hub 底栏的一个动作现在能不能点（omp 给的 `disabled` 原样带回原因）。 */
export function hubActionState(hub: AgentHubView, act: string): HubActionState {
  const action = hub.actions.find((candidate) => candidate.id === act);
  if (!action) return { state: "missing" };
  if (action.disabled === undefined) return { state: "ready" };
  return { state: "disabled", reason: typeof action.disabled === "string" ? action.disabled : null };
}

/** Hub 里这一项被结束过（点 `kill` 之后 `dot` 变 `error`，hub-kill 录制）。 */
export function hubItemKilled(hub: AgentHubView, name: string): boolean {
  return hub.items.find((item) => item.id === name)?.dot === "error";
}

/** hud 里 `👥` 胶囊：点击动作是 `agents.open` 的节点；没有子代理在跑时它不在。 */
export function findHubOpener(doc: TspDocument): { sf: string; id: string } | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      const actions = node.p["actions"];
      if (isRecord(actions) && actions["click"] === HUB_OPEN_ACTION) return { sf, id: node.id };
    }
  }
  return null;
}

// ───────── 聚焦模式 ─────────

export interface FocusView {
  sf: string;
  /** 正在看的子代理名。 */
  name: string;
  /** 退出按钮（`omp.composer.exit`）和它的 `actions.click`（`focus:Main`）；找不到为 null（改用 Esc 键）。 */
  exit: { id: string; act: string } | null;
}

/** composer 卡片里的聚焦行（`omp.composer.focus`，"Viewing subagent <名字>: what you send goes to it"）；没在聚焦为 null。 */
export function findFocus(doc: TspDocument): FocusView | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const row = findNode(surface, (node) => nodeRole(node) === FOCUS_ROLE, "dock");
    if (!row) continue;
    const agent = findNode(surface, (node) => nodeRole(node) === FOCUS_AGENT_ROLE, row.id);
    const name = agent ? spansText(agent.p["text"] ?? agent.p["spans"]) : "";
    if (name === "") continue;
    const exitNode = findNode(surface, (node) => nodeRole(node) === FOCUS_EXIT_ROLE, row.id);
    const actions = exitNode?.p["actions"];
    const act = isRecord(actions) && typeof actions["click"] === "string" ? actions["click"] : null;
    return { sf, name, exit: exitNode && act ? { id: exitNode.id, act } : null };
  }
  return null;
}

// ───────── 驱动 Hub 的用户消息回显 ─────────

/** 文档里用户消息 / 排队消息节点的个数：聚焦模式下 `send` 之后 omp 回显它（hub-steer 录制），个数增加 = 消息被接收。 */
export function countEchoNodes(doc: TspDocument): number {
  let count = 0;
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      const role = nodeRole(node);
      if (role === "omp.user" || role === "omp.queue") count += 1;
    }
  }
  return count;
}

/** 子代理名是 omp 的 `Outer-3.Inner` 一类，同时是会话文件名：字符集和长度在这里限死，调用方不用再各自写一遍。 */
export const AGENT_NAME_PATTERN = /^[A-Za-z0-9_][\w.-]{0,127}$/;

export function isAgentName(value: unknown): value is string {
  return typeof value === "string" && AGENT_NAME_PATTERN.test(value) && !value.includes("..");
}
