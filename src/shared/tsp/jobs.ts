// 后台作业（输入框上方"后台任务 / 子代理"按钮的数据）：从 omp 的节点读，数据形状见 shared/ui/jobs.ts。
//
// 数据来源（omp 18.12.5 实测，fixtures/tsp/jobs-chart.jsonl、hub-steer.jsonl；role 是 omp 自己的命名，不在 TSP 规范里，
// 判断集中在这里，omp 改名就失效，升级时跑一遍录制）：
// - hud 的作业胶囊 `omp.hud.seg`（`actions.click === "jobs.open"`）：只在有作业**运行中**时存在（全结束就整条消失）。
//   `title` = `"2 jobs running  /jobs\n<id>  <标题>\n<id>  <标题>"`，第一行之后每行一个作业，id 和标题之间是两个空格。
//   bash 作业的 id 是 `bg_N`，子代理作业的 id 就是子代理名（同一个名字有 `agent` 节点）。
// - `/jobs` 弹窗（`omp.overlay.jobs`）里 `omp.jobs.master` 下的 `list`：每个 `item` 的 `title` 第二行是
//   `<状态> · <类型> · <id>`（`Running|Done|Failed|Cancelled · bash · bg_1`），`label` 是命令，`value` 是时长（`43.9s`、`305ms`）。
//   弹窗里有全部状态，但只有它开着的时候在文档里。
// 终端里弹窗关了作业就只剩 hud；所以渲染进程每批消息后把快照并进已知作业（mergeTspJobs）：运行中消失的作业记为结束。
// 纯函数，不碰 DOM；解析不了的行跳过，界面只是少一行，不会报错。
import type { Job } from "../ui/jobs.ts";
import { isRecord } from "../type-guards.ts";
import { findNode, nodeRole, spansText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

type JobStatus = Job["status"];

const HUD_JOBS_ROLE = "omp.hud.seg";
const HUD_JOBS_ACTION = "jobs.open";
const OVERLAY_MASTER_ROLE = "omp.jobs.master";
const BASH_ID = /^bg_\d+$/;

/** hud 作业胶囊：点它 = omp 打开 `/jobs` 弹窗（动作 `jobs.open`）。 */
function isJobsClick(node: DocNode): boolean {
  const actions = node.p["actions"];
  return isRecord(actions) && actions["click"] === HUD_JOBS_ACTION;
}

/** `43.9s` / `305ms` / `1m 12s` / `2h 3m` → 毫秒；认不出为 null。 */
export function parseJobDuration(text: string): number | null {
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)\b/g)) {
    total += Number(match[1]) * unit[match[2] as keyof typeof unit];
    found = true;
  }
  return found ? Math.round(total) : null;
}

function statusFromWord(word: string, tone: unknown): JobStatus {
  switch (word.toLowerCase()) {
    case "running":
      return "running";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  // 没见过的状态词：看色调（pending 运行中 / success 完成 / error 失败 / muted 取消）。
  if (tone === "success") return "completed";
  if (tone === "error") return "failed";
  if (tone === "muted") return "cancelled";
  return "running";
}

function agentStatus(status: unknown): JobStatus | null {
  switch (status) {
    case "pending":
    case "running":
      return "running";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "cancelled";
    default:
      return null;
  }
}

function liveSurfaces(doc: TspDocument): DocSurface[] {
  const out: DocSurface[] = [];
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (surface) out.push(surface);
  }
  return out;
}

/** 文档里所有 `agent` 节点：名字 → 状态（子代理作业的类型和最终状态靠它）。 */
function agentStatuses(doc: TspDocument): Map<string, JobStatus | null> {
  const out = new Map<string, JobStatus | null>();
  for (const surface of liveSurfaces(doc)) {
    for (const node of surface.nodes.values()) {
      if (node.k === "agent" && typeof node.p["name"] === "string")
        out.set(node.p["name"], agentStatus(node.p["status"]));
    }
  }
  return out;
}

/** `/jobs` 弹窗列表里的作业（全部状态）。 */
function overlayJobs(doc: TspDocument, now: number, agents: ReadonlyMap<string, JobStatus | null>): Job[] {
  const jobs: Job[] = [];
  for (const surface of liveSurfaces(doc)) {
    const master = findNode(surface, (node) => nodeRole(node) === OVERLAY_MASTER_ROLE);
    if (!master) continue;
    for (const listId of master.c) {
      const list = surface.nodes.get(listId);
      if (list?.k !== "list") continue;
      for (const itemId of list.c) {
        const item = surface.nodes.get(itemId);
        if (item) {
          const job = overlayItem(item, now, agents);
          if (job) jobs.push(job);
        }
      }
    }
  }
  return jobs;
}

/**
 * omp 的作业类型（`/jobs` 弹窗里的 `<状态> · <类型> · <id>`，job-manager 的 `register(type, …)`）：`bash`、`eval`（eval 工具的异步单元）、
 * `task`（后台子任务：子代理、vibe、安全扫描等）。id 有对应 `agent` 节点的 task = 子代理（`agent`）：药丸另有一段数子代理，不算作业。
 * 没见过的类型归 `task`（omp 的 hud 作业胶囊按 `type !== "task" || agentId` 数，这里同样把非子代理的都算作业）。
 */
function jobType(kind: string, id: string, agents: ReadonlyMap<string, JobStatus | null>): Job["type"] {
  if (kind === "bash" || kind === "eval") return kind;
  return agents.has(id) ? "agent" : "task";
}

function overlayItem(item: DocNode, now: number, agents: ReadonlyMap<string, JobStatus | null>): Job | null {
  const title = typeof item.p["title"] === "string" ? item.p["title"] : "";
  const meta = /^(\S+) · (\S+) · (.+)$/.exec(title.split("\n")[1] ?? "");
  if (!meta) return null;
  const word = meta[1] ?? "";
  const kind = meta[2] ?? "";
  const id = meta[3] ?? "";
  const status = statusFromWord(word, item.p["tone"]);
  // 标题第一行是纯命令；`label` 的 span 里子代理自己起的作业前面带树形前缀（`└─ sleep 75`，hub-steer 录制）。
  const label = (title.split("\n")[0] ?? "") || spansText(item.p["label"]).replace(/^[│├└─ ]+/, "") || id;
  const durationMs = parseJobDuration(spansText(item.p["value"]));
  return {
    id,
    type: jobType(kind, id, agents),
    label,
    status,
    startedAt: status === "running" && durationMs !== null ? now - durationMs : now,
    durationMs: status === "running" ? null : durationMs,
    output: null,
  };
}

/** hud 作业胶囊里的运行中作业。 */
function hudJobs(doc: TspDocument, now: number, agents: ReadonlyMap<string, JobStatus | null>): Job[] {
  const jobs: Job[] = [];
  for (const surface of liveSurfaces(doc)) {
    for (const node of surface.nodes.values()) {
      if (nodeRole(node) !== HUD_JOBS_ROLE) continue;
      if (!isJobsClick(node)) continue;
      if (typeof node.p["title"] !== "string") continue;
      for (const row of node.p["title"].split("\n").slice(1)) {
        const parsed = /^(\S+) {2}(.*)$/.exec(row);
        if (!parsed) continue;
        const id = parsed[1] as string;
        const label = parsed[2] || id;
        const type: Job["type"] = agents.has(id) ? "agent" : BASH_ID.test(id) ? "bash" : "task";
        jobs.push({ id, type, label, status: "running", startedAt: now, durationMs: null, output: null });
      }
    }
  }
  return jobs;
}

/**
 * 文档里现在看得到的作业：`/jobs` 弹窗（有就以它为准，状态最全）加上 hud 里运行中的。`now` 只用来给"第一次看到"的作业定开始时间。
 */
export function deriveTspJobs(doc: TspDocument, now: number): Job[] {
  const agents = agentStatuses(doc);
  const byId = new Map<string, Job>();
  for (const job of hudJobs(doc, now, agents)) byId.set(job.id, job);
  for (const job of overlayJobs(doc, now, agents)) byId.set(job.id, job);
  return [...byId.values()];
}

/**
 * 把这一刻的快照并进已知作业（按首次出现的顺序）：
 * - 开始时间沿用已知的；
 * - 已知运行中、快照里没了：子代理看它的 `agent` 节点（done/failed/aborted），否则记为完成，时长 = 现在 − 开始；
 * - 快照里有的，状态和时长以快照为准。
 */
export function mergeTspJobs(previous: readonly Job[], snapshot: readonly Job[], doc: TspDocument, now: number): Job[] {
  const seen = new Map(snapshot.map((job) => [job.id, job]));
  const agents = agentStatuses(doc);
  const out: Job[] = [];
  for (const old of previous) {
    const fresh = seen.get(old.id);
    if (fresh) {
      // hud 行里 bash 和 eval 的 id 都是 `bg_N`，只能猜 bash；`/jobs` 弹窗开过就知道真实类型，之后 hud 的猜测不覆盖它。
      out.push({ ...fresh, type: fresh.type === "bash" ? old.type : fresh.type, startedAt: old.startedAt });
      seen.delete(old.id);
    } else if (old.status === "running") {
      const status = agents.get(old.id) ?? "completed";
      out.push({
        ...old,
        status: status === "running" ? "completed" : status,
        durationMs: Math.max(0, now - old.startedAt),
      });
    } else {
      out.push(old);
    }
  }
  for (const job of seen.values()) out.push(job);
  return out;
}

/**
 * 药丸右半段的作业：运行中、且不是子代理的（omp hud 作业胶囊的数法：`runningBackgroundJobCount` 排除有 agentId 的 task；
 * 子代理另有药丸左半段，bash 和 eval 作业、非子代理的后台 task 都算）。
 */
export function runningJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter((job) => job.status === "running" && job.type !== "agent");
}

/** 用户结束了作业（`id` 或 `all`）：已知运行中的记为取消，时长 = 现在 − 开始。 */
export function markJobsCancelled(jobs: readonly Job[], id: string, now: number): Job[] {
  return jobs.map((job) =>
    job.status === "running" && (id === "all" || job.id === id)
      ? { ...job, status: "cancelled", durationMs: Math.max(0, now - job.startedAt) }
      : job,
  );
}

/** 两份作业列表内容相同（store 用它决定要不要换引用）。 */
export function sameJobs(a: readonly Job[], b: readonly Job[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((job, index) => {
    const other = b[index] as Job;
    return (
      job.id === other.id &&
      job.type === other.type &&
      job.label === other.label &&
      job.status === other.status &&
      job.startedAt === other.startedAt &&
      job.durationMs === other.durationMs
    );
  });
}

/**
 * `/jobs` 弹窗里某个作业所在的列表和列表项（omp 自己的选中动作 `select` 的目标：`id` 是列表、`item` 是列表项，
 * omp 18.12.6 的 `native/backend.ts` 按 `id` 找组件、把以 `<列表>/` 开头的 `item` 换回列表里的 key）；弹窗没开或没有这个作业为 null。
 * 渲染进程打开 omp 的弹窗后发 `select`，把右边的详情（含输出）切到这个作业。
 */
export function findJobsOverlayItem(
  doc: TspDocument,
  jobId: string,
): { sf: string; list: string; item: string } | null {
  for (const surface of liveSurfaces(doc)) {
    const master = findNode(surface, (node) => nodeRole(node) === OVERLAY_MASTER_ROLE);
    if (!master) continue;
    for (const listId of master.c) {
      const list = surface.nodes.get(listId);
      if (list?.k !== "list") continue;
      for (const itemId of list.c) {
        const item = surface.nodes.get(itemId);
        const title = typeof item?.p["title"] === "string" ? item.p["title"] : "";
        if (item && (title.split("\n")[1] ?? "").endsWith(` · ${jobId}`))
          return { sf: surface.id, list: list.id, item: item.id };
      }
    }
  }
  return null;
}

/** hud 上的作业胶囊（点它 = omp 打开 `/jobs` 弹窗，动作 `jobs.open`）；没有运行中作业时为 null。 */
export function findJobsHudSeg(doc: TspDocument): { sf: string; id: string } | null {
  for (const surface of liveSurfaces(doc)) {
    for (const node of surface.nodes.values()) {
      if (nodeRole(node) === HUD_JOBS_ROLE && isJobsClick(node)) return { sf: surface.id, id: node.id };
    }
  }
  return null;
}

/**
 * hud 作业胶囊悬停卡片里的一个作业（omp 的 `omp.job.tile`）。卡片是胶囊的 `hovercard` 属性（一棵不带 id 的节点树），
 * omp 18.12.5 录制（fixtures/tsp/jobs-chart.jsonl）、18.12.6 实测，每个作业是：头一行 `omp.job.tile.dot` / `.title` / `.id`；
 * omp 的作业小部件有进度时再有 `.figure`（`done 21`）、`meter`（`.meter`，0-1）、`.stats`、`.stage`，没有时是一行 `.lead`（最近的输出）。
 */
export interface JobTile {
  id: string;
  title: string;
  /** 进度 0-1；omp 的作业小部件没给进度条时为 null。 */
  meter: number | null;
  /** 进度条旁边的数字（`done 21`），没有为空串。 */
  figure: string;
  /** 头和数字之外的文字行，按 omp 的顺序（`passed 21 · failed 0`、当前阶段、最近的输出）。 */
  notes: string[];
}

const TILE_ROLE = "omp.job.tile";

function propChildren(node: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(node["c"]) ? node["c"].filter(isRecord) : [];
}

function propTile(node: Record<string, unknown>): JobTile | null {
  const tile: JobTile = { id: "", title: "", meter: null, figure: "", notes: [] };
  const visit = (child: Record<string, unknown>): void => {
    const props = isRecord(child["p"]) ? child["p"] : {};
    if (child["k"] === "meter") {
      const value = props["value"];
      if (typeof value === "number" && Number.isFinite(value)) tile.meter = Math.min(1, Math.max(0, value));
      return;
    }
    if (child["k"] === "text") {
      const text = (typeof props["text"] === "string" ? props["text"] : spansText(props["spans"])).trim();
      if (props["role"] === `${TILE_ROLE}.title`) tile.title = text;
      else if (props["role"] === `${TILE_ROLE}.id`) tile.id = text;
      else if (props["role"] === `${TILE_ROLE}.figure`) tile.figure = text;
      else if (props["role"] !== `${TILE_ROLE}.dot` && text !== "") tile.notes.push(text);
      return;
    }
    for (const next of propChildren(child)) visit(next);
  };
  visit(node);
  return tile.id === "" ? null : tile;
}

/** hud 作业胶囊悬停卡片里的作业（只在有作业运行中时有）。 */
export function deriveJobTiles(doc: TspDocument): JobTile[] {
  const seg = findJobsHudSeg(doc);
  const card = seg ? doc.surfaces.get(seg.sf)?.nodes.get(seg.id)?.p["hovercard"] : undefined;
  const tiles: JobTile[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (isRecord(node["p"]) && node["p"]["role"] === TILE_ROLE) {
      const tile = propTile(node);
      if (tile) tiles.push(tile);
      return;
    }
    for (const child of propChildren(node)) visit(child);
  };
  if (isRecord(card)) visit(card);
  return tiles;
}

/** 两份卡片内容相同（store 用它决定要不要换引用）。 */
export function sameJobTiles(a: readonly JobTile[], b: readonly JobTile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tile, index) => {
    const other = b[index] as JobTile;
    return (
      tile.id === other.id &&
      tile.title === other.title &&
      tile.meter === other.meter &&
      tile.figure === other.figure &&
      tile.notes.join("\n") === other.notes.join("\n")
    );
  });
}
