// 连续的工具调用合成一组（issue #9，2026-11-09 仓库所有者批准；docs/architecture/conversation.md「连续工具调用合成一组」）。
// 工具卡（`k:"tool"`）是 `main` 的直接子节点，和助手列（`col omp.assistant`）交替出现（实录 omp 18.12.3 task.jsonl、
// 18.12.4 resume.jsonl）。夹在两张卡中间、不画正文的助手列（空的、只有思考块的）不打断一串，归进去一起收；
// 有正文的回答、用户消息之类的其它节点打断。子代理的等待卡（磁贴默认看得见，2026-10-22 定）和提问卡（问答是对话内容）
// 也打断，自己不进组。至少两张工具卡才算一组。纯函数，渲染进程按它在 MainFlow 里插组头。
import { spansText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";
import type { NodeDeps } from "./node-watch.ts";

const ASSISTANT_ROLE = "omp.assistant";
/** 打断一串、自己也不进组的工具卡。 */
const STANDALONE_TOOLS: ReadonlySet<string> = new Set(["omp.tool.wait", "omp.tool.ask"]);

export interface RunTool {
  readonly id: string;
  /** omp 的调用 id（`p.key`）：一串的成员会变（待办卡被删了再加到后面），用户的展开 / 收起按它记。 */
  readonly key: string;
  /** omp 的工具状态：pending / running / done / error / cancelled。 */
  readonly status: string;
  /** omp 的工具名（`bash`、`read` …）：组头按它分种、画小图标和次数。 */
  readonly name: string;
  /** 卡片标题（`p.title`，字符串或 spans 拼成的纯文字）和目标（`p.target`），没有时为空串：组头悬停每张卡一行。 */
  readonly title: string;
  readonly target: string;
  /** omp 报的这次调用执行用时（`p.took`，毫秒），完成后才有；组头把它们加起来。 */
  readonly took: number | null;
}

export interface ToolRun {
  /** 组里全部节点（工具卡和夹在中间的助手列），按 main 里的顺序。 */
  readonly members: readonly string[];
  readonly tools: readonly RunTool[];
  /** 后面再没有会打断它的节点（只有不画正文的助手列或什么都没有）：这一轮可能还在往这一串里加卡。 */
  readonly last: boolean;
}

/** 推导只读这些节点：工具卡、助手列和它们的子节点（看列里有没有正文），加上父节点（main 的子节点增删）。 */
export const TOOL_RUN_NODES: NodeDeps = { kinds: ["tool"], roles: [ASSISTANT_ROLE], children: true, parent: true };

function isRunTool(node: DocNode): boolean {
  return node.k === "tool" && !STANDALONE_TOOLS.has(String(node.p["role"]));
}

/** 不画正文的助手列：没有子节点，或子节点都是思考块 / hidden / 空的 md。 */
function isQuietAssistant(node: DocNode, peek: (id: string) => DocNode | undefined): boolean {
  if (node.k !== "col" || node.p["role"] !== ASSISTANT_ROLE) return false;
  if (node.p["hidden"] === true) return true;
  return node.c.every((id) => {
    const child = peek(id);
    if (child === undefined || child.p["hidden"] === true) return true;
    const role = child.p["role"];
    if (typeof role === "string" && role.startsWith("omp.thinking")) return true;
    return child.k === "md" && String(child.p["text"] ?? "").trim() === "";
  });
}

function runTool(node: DocNode): RunTool {
  const { key, status, name, title, target, took } = node.p;
  return {
    id: node.id,
    key: typeof key === "string" ? key : node.id,
    status: typeof status === "string" ? status : "done",
    name: typeof name === "string" ? name : "",
    title: spansText(title),
    target: typeof target === "string" ? target : "",
    took: typeof took === "number" && Number.isFinite(took) && took >= 0 ? took : null,
  };
}

/**
 * 一个 surface 的 main 里的工具组。挂在组员后面的状态行（statusNotes）不算打断：组收起时它们照常画在组头下面（MainFlow）。
 */
export function toolRuns(surface: DocSurface): ToolRun[] {
  const main = surface.nodes.get("main");
  if (main === undefined) return [];
  const peek = (id: string) => surface.nodes.get(id);
  const runs: ToolRun[] = [];
  let members: string[] = [];
  let tools: RunTool[] = [];
  /** 最后一张卡之后、还没确定归不归进来的安静助手列。 */
  let pending: string[] = [];
  const close = (last: boolean) => {
    if (tools.length >= 2) runs.push({ members, tools, last });
    members = [];
    tools = [];
    pending = [];
  };
  for (const id of main.c) {
    const node = peek(id);
    if (node === undefined) continue;
    if (isRunTool(node)) {
      members.push(...pending, id);
      pending = [];
      tools.push(runTool(node));
    } else if (tools.length > 0 && isQuietAssistant(node, peek)) {
      pending.push(id);
    } else {
      close(false);
      continue;
    }
  }
  close(true);
  return runs;
}

/** 每个 surface 的工具组（渲染进程按任务推导一次，各 surface 的 MainFlow 取自己的）。 */
export function toolRunsBySurface(doc: TspDocument): ReadonlyMap<string, readonly ToolRun[]> {
  const out = new Map<string, readonly ToolRun[]>();
  for (const [sf, surface] of doc.surfaces) {
    const runs = toolRuns(surface);
    if (runs.length > 0) out.set(sf, runs);
  }
  return out;
}

export function sameToolRunsBySurface(
  a: ReadonlyMap<string, readonly ToolRun[]>,
  b: ReadonlyMap<string, readonly ToolRun[]>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [sf, runs] of a) {
    const other = b.get(sf);
    if (other === undefined || !sameToolRuns(runs, other)) return false;
  }
  return true;
}

export function sameToolRuns(a: readonly ToolRun[], b: readonly ToolRun[]): boolean {
  return (
    a.length === b.length &&
    a.every((run, i) => {
      const other = b[i]!;
      return (
        run.last === other.last &&
        run.members.length === other.members.length &&
        run.tools.length === other.tools.length &&
        run.members.every((id, j) => id === other.members[j]) &&
        run.tools.every((tool, j) => {
          const that = other.tools[j]!;
          return (
            tool.id === that.id &&
            tool.key === that.key &&
            tool.status === that.status &&
            tool.name === that.name &&
            tool.title === that.title &&
            tool.target === that.target &&
            tool.took === that.took
          );
        })
      );
    })
  );
}

/** 还在跑的工具卡状态。 */
export const LIVE_TOOL_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

/** 用户点组头时记下的：当时的默认展开状态（basis）和点成了什么。 */
export interface RunFold {
  readonly basis: boolean;
  readonly open: boolean;
}

/**
 * 一组展开着没有。默认：还在往里加卡（有卡在跑，或这一组在对话末尾且任务在跑）或 omp 的工具输出展开着（Ctrl+O）时展开，否则收起。
 * 用户点过组头（fold）以它为准，直到默认值变了（跑完了、Ctrl+O）：那时记录作废（stale），回到默认值，和 use-fold.ts 一样。
 * `ended`：omp 进程已经不在了（没有东西在跑）。
 */
export function runOpen(
  run: ToolRun,
  context: { ended: boolean; busy: boolean; expanded: boolean },
  fold: RunFold | undefined,
): { open: boolean; basis: boolean; stale: boolean } {
  const live =
    !context.ended && (run.tools.some((tool) => LIVE_TOOL_STATUSES.has(tool.status)) || (run.last && context.busy));
  const basis = live || context.expanded;
  const stale = fold !== undefined && fold.basis !== basis;
  return { open: fold !== undefined && !stale ? fold.open : basis, basis, stale };
}
