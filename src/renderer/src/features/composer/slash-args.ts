// studio 接管的斜杠命令按参数分派（纯函数；studio-slash-table.ts 里各命令的 run 调它们，再去做界面动作）。
// 规则（wave B 3.3）：不带参数 = 打开 studio 的界面；带 studio 认得的参数 = 直接做（桌面端控件的等价操作）；
// studio 不认识的参数 = `omp`（原样把这条命令发给 omp，由它自己处理 / 报错）。
import type { ModelKey, ModelOption } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskCommand } from "../../../../shared/omp-output/index.ts";
import { groupModels } from "./model-groups.ts";

/** 打开模型选择器时带的搜索词和范围。 */
export interface ModelPickerRequest {
  query: string;
  /** `roles` = 左栏的"角色"范围（`/model @task`：给角色选模型）。 */
  scope: "all" | "roles";
}

export type ModelCommand =
  /** 打开选择器（不带参数、带了 `@角色`、或匹配到多个模型时填好搜索词让用户挑）。 */
  | { kind: "picker"; request: ModelPickerRequest }
  /** 唯一匹配：直接切换（`:档位` 后缀同时设思考强度）。 */
  | { kind: "switch"; key: ModelKey; level: string | null }
  /** 目录里一个都没匹配到：原样交给 omp。 */
  | { kind: "omp" };

/** `sonnet:high` → 词 `sonnet`、档位 `high`；档位不是 omp 的几个档位名时 `:` 当作模型 id 的一部分（如 `ollama/llama3:8b`）。 */
const LEVEL_SUFFIX = /^(.*\S):(off|minimal|low|medium|high|xhigh|max|auto)$/i;

export function parseModelArg(args: string): { term: string; level: string | null } {
  const match = LEVEL_SUFFIX.exec(args.trim());
  return match ? { term: match[1] ?? "", level: (match[2] ?? "").toLowerCase() } : { term: args.trim(), level: null };
}

/** 草稿页没有模型目录可匹配：不管词是什么都只填进选择器的搜索框（`@角色` 仍然进角色范围）。 */
export function pickerRequestFor(args: string): ModelPickerRequest {
  const { term } = parseModelArg(args);
  return term.startsWith("@") ? { query: term.slice(1).trim(), scope: "roles" } : { query: term, scope: "all" };
}

/**
 * `/model [词]`：词按模型选择器同一个搜索函数（`groupModels`：名称 / provider / 模型 id 的子串，不分大小写）匹配目录。
 * 唯一结果直接切换；多个结果先看有没有一个的 id 或 `provider/id` 和输入完全一样（`/model gpt-5` 不被 `gpt-5-mini` 抢走），
 * 否则打开选择器并填好搜索词；一个都没有交给 omp。`@角色` 打开选择器的角色范围。
 */
export function resolveModelCommand(args: string, models: readonly ModelOption[]): ModelCommand {
  const { term, level } = parseModelArg(args);
  if (term === "") return { kind: "picker", request: { query: "", scope: "all" } };
  if (term.startsWith("@")) return { kind: "picker", request: { query: term.slice(1).trim(), scope: "roles" } };
  const hits = groupModels(models, term, []).flat;
  if (hits.length === 0) return { kind: "omp" };
  const lower = term.toLowerCase();
  const exact = hits.filter(
    (model) =>
      model.key.modelId.toLowerCase() === lower || `${model.key.provider}/${model.key.modelId}`.toLowerCase() === lower,
  );
  const chosen = hits.length === 1 ? hits[0] : exact.length === 1 ? exact[0] : undefined;
  if (chosen === undefined) return { kind: "picker", request: { query: term, scope: "all" } };
  return { kind: "switch", key: chosen.key, level };
}

export type EffortCommand =
  | { kind: "picker" }
  | { kind: "set"; level: ThinkingLevel }
  /** 不是这个模型的档位：原样交给 omp。 */
  | { kind: "omp" };

/** `/effort [档位]`：档位在这个任务的可选档位里（`TaskState.thinkingLevels`，不分大小写）就直接设置。 */
export function resolveEffortCommand(args: string, levels: readonly ThinkingLevel[]): EffortCommand {
  const wanted = args.trim().toLowerCase();
  if (wanted === "") return { kind: "picker" };
  const level = levels.find((candidate) => candidate.toLowerCase() === wanted);
  return level === undefined ? { kind: "omp" } : { kind: "set", level };
}

export type TodoCommand =
  /** 不带参数：打开待办板。 */
  | { kind: "board" }
  /** 待办操作：走 B1Board 定的 TaskCommand（`runTaskCommand`）。 */
  | { kind: "command"; command: Extract<TaskCommand, { kind: "todo" }> }
  /** `/todo` 的其余子命令（edit / copy / expand / export / import）和缺参数的：原样交给 omp。 */
  | { kind: "omp" };

/** omp 18.12.6 `/todo append [<阶段>] <任务…>`：阶段写在方括号里，可省略。 */
const APPEND_PHASE = /^\[([^\]]+)\]\s*([\s\S]+)$/;

export function resolveTodoCommand(args: string): TodoCommand {
  const trimmed = args.trim();
  if (trimmed === "") return { kind: "board" };
  const space = trimmed.search(/\s/);
  const sub = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : trimmed.slice(space).trim();
  switch (sub) {
    case "start":
      return rest === "" ? { kind: "omp" } : { kind: "command", command: { kind: "todo", op: "start", target: rest } };
    case "done":
    case "drop":
    case "rm":
      return {
        kind: "command",
        command: rest === "" ? { kind: "todo", op: sub } : { kind: "todo", op: sub, target: rest },
      };
    case "append": {
      if (rest === "") return { kind: "omp" };
      const withPhase = APPEND_PHASE.exec(rest);
      return {
        kind: "command",
        command: withPhase
          ? { kind: "todo", op: "append", phase: (withPhase[1] ?? "").trim(), task: (withPhase[2] ?? "").trim() }
          : { kind: "todo", op: "append", task: rest },
      };
    }
    default:
      return { kind: "omp" };
  }
}
