// eval 卡片一个 cell（col `omp.run`）的输出（实测 omp 18.13.1，2026-10-28，fixtures/tsp/eval-split-output.jsonl）：
// 打印较长的对象（如 Python 的长 tuple）时，omp 把它画成 JSON 视图（tree），
// 前后的文字切成几段 ansi（`omp.tool.eval.output`，各自 preview 10 行），卡片 preview 是 "children"，没有总上限：
// 折叠时每段各露 10 行，合起来照样很长。这里找出这一串输出，交给渲染层合成一段一起夹紧。纯函数。

interface RunChild {
  readonly k: string;
  readonly p: Readonly<Record<string, unknown>>;
}

const OUTPUT_ROLE = "omp.tool.eval.output";
/** 输出之前的（标题、代码）和之后的（底栏、状态事件）。 */
const BEFORE_ROLES: ReadonlySet<string> = new Set(["omp.run.caption", "omp.tool.eval.input"]);
const AFTER_ROLES: ReadonlySet<string> = new Set(["omp.run.foot", "omp.run.status"]);

export interface RunOutputSpan {
  /** 子节点下标，[start, end)。 */
  readonly start: number;
  readonly end: number;
  /** 折叠时一共露几行（取第一段文字输出的 preview）。 */
  readonly lines: number;
}

/** 输出切成了两段以上时返回它们的范围；只有一段（它自己会夹紧）、不是 eval 输出时返回 null。 */
export function runOutputSpan(children: readonly (RunChild | null | undefined)[]): RunOutputSpan | null {
  const role = (child: RunChild | null | undefined): string =>
    typeof child?.p["role"] === "string" ? child.p["role"] : "";
  let start = 0;
  while (start < children.length && BEFORE_ROLES.has(role(children[start]))) start += 1;
  let end = start;
  while (end < children.length && !AFTER_ROLES.has(role(children[end]))) end += 1;
  if (end - start < 2) return null;
  const text = children.slice(start, end).find((child) => child?.k === "ansi" && role(child) === OUTPUT_ROLE);
  const preview = text?.p["preview"];
  const lines =
    typeof preview === "object" && preview !== null && "lines" in preview && typeof preview.lines === "number"
      ? Math.floor(preview.lines)
      : 0;
  return lines >= 1 ? { start, end, lines } : null;
}
