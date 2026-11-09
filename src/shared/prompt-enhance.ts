// 提示词优化（输入框发送键左边的 ✦）：渲染进程和主进程共用的类型和纯函数。设计和 omp 实测见 docs/architecture/prompt-enhance.md。
import type { ProjectId, TaskId } from "./ipc.ts";

/** 哪个输入框在优化：任务的，或新任务草稿页的（项目为 null = 默认文件夹）。主进程按它定 cwd，每个输入框同时只有一次。 */
export type PromptEnhanceTarget = { kind: "task"; taskId: TaskId } | { kind: "draft"; projectId: ProjectId | null };

export type PromptEnhanceResult =
  /** 改写好的整段草稿（附件占位符都还在），界面一次替换进输入框。 */
  | { kind: "enhanced"; text: string }
  /** omp 找不到能用的模型（`No model available` / `No API key`）。 */
  | { kind: "no_model" }
  /** 改写结果丢了草稿里的附件占位符（`[Image #1, …]` 这类），不能替换：替换了附件会跟着被删。 */
  | { kind: "markers_lost" }
  /** omp 出错（stderr 里的错误行）、超时或者没有输出。 */
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

/** 一次最多送多少字符（主进程校验；草稿再长也不该整段交给小模型改写）。 */
export const PROMPT_ENHANCE_MAX_CHARS = 32_000;

/** 草稿文字里的附件占位符：omp 的 `[Image #N, WxH]`、`[Paste #N, +X lines]`，studio 的 `[File #N, 名字]`（composer-tokens.ts）。 */
const markerPattern = /\[(?:Image|Paste|File) #[1-9]\d*(?:,[^\]\n]*)?\]/g;

/** 草稿里的附件占位符，按出现顺序（同一个出现两次就记两次）。 */
export function draftMarkers(text: string): string[] {
  return text.match(markerPattern) ?? [];
}

/** 草稿里有、改写结果里少了的占位符（按次数比，原样比较）。 */
export function missingMarkers(draft: string, result: string): string[] {
  const left = draftMarkers(result);
  const missing: string[] = [];
  for (const marker of draftMarkers(draft)) {
    const at = left.indexOf(marker);
    if (at === -1) missing.push(marker);
    else left.splice(at, 1);
  }
  return missing;
}

/** 能不能优化：去掉附件占位符后还有字，且不是斜杠命令（`/` 开头的是给 omp 的命令，不是要改写的话）。 */
export function canEnhance(text: string): boolean {
  const words = text.replace(markerPattern, "").trim();
  return words !== "" && !text.trimStart().startsWith("/");
}
