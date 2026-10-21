// 输入框上方状态行的"当前活动"文字：omp 在 dock 里画的运行状态行（`omp.working`：旋转图标 + 用时 + `·` + 一句话 + Stop）
// 的那一句话，节点 role `omp.working.label`（k `shimmer`，`spans[].t`），例如 `Running sleep 10`、`Waiting for sleep job to finish`、
// `Compacting context…`、`Working…`。studio 把整行 omp 状态行（连同它所在的 `omp.hud.activity`）藏起来，自己画状态行
// （composer/ComposerStatus.tsx）：用时用主进程记的这一轮开始时间，文字取这里。omp 18.12.5 实测，录制见 fixtures/tsp/*.jsonl
// （test/tsp-working.test.ts 逐帧核对）。role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
// 另有一次性的 `omp.loader`（旋转图标 + `text`）出现在同一个位置，没有 label 时用它的文字。
import { findNode, nodeRole, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

const LABEL_ROLE = "omp.working.label";
/**
 * 不画的 omp HUD（studio 自己的状态行取代）：`omp.hud`（作业 / 子代理胶囊 `omp.hud.pill` 里的 `omp.hud.seg`，点它是 `jobs.open` / `agents.open`）
 * 和 `omp.hud.activity`（运行状态行 `omp.working`、一次性的 `omp.loader`、待办药丸 `omp.hud.todo`）。数据都在 studio 的输入框上方：
 * 药丸（子代理数 `listAgents`、作业数 `deriveTspJobs`）、状态行（用时 + 这里的文字）、待办板（shared/tsp/todos.ts）。
 */
export const HIDDEN_HUD_ROLES: ReadonlySet<string> = new Set(["omp.hud", "omp.hud.activity"]);
const LOADER_ROLE = "omp.loader";

function spansText(node: DocNode): string {
  const { spans, text } = node.p;
  if (typeof text === "string") return text;
  if (!Array.isArray(spans)) return "";
  let joined = "";
  for (const span of spans as readonly unknown[]) {
    if (span !== null && typeof span === "object" && "t" in span && typeof span.t === "string") joined += span.t;
  }
  return joined;
}

function labelIn(surface: DocSurface): string | null {
  const label = findNode(surface, (node) => nodeRole(node) === LABEL_ROLE, "dock");
  const text = label ? spansText(label).trim() : "";
  if (text !== "") return text;
  const loader = findNode(surface, (node) => nodeRole(node) === LOADER_ROLE, "dock");
  if (!loader) return null;
  const inner = findNode(surface, (node) => node.k === "text" && spansText(node).trim() !== "", loader.id);
  const loaded = inner ? spansText(inner).trim() : "";
  return loaded === "" ? null : loaded;
}

/**
 * omp 现在在做什么（一句话）；没有运行状态行、或行里没有文字时为 null（界面退回"运行中"）。
 * 多个活 surface（如 /settings 盖在上面）时取第一个有 dock 且有文字的。
 */
export function deriveWorkingLabel(doc: TspDocument): string | null {
  for (const id of doc.live) {
    const surface = doc.surfaces.get(id);
    if (!surface?.nodes.has("dock")) continue;
    const label = labelIn(surface);
    if (label !== null) return label;
  }
  return null;
}
