// "agent 的改动说明"：从对话流的轮里取出每个文件被哪些 edit / write / ast_edit 工具改过、工具的 intent，
// 以及那一轮的结论文字。纯函数，不碰 DOM；test/review-explain.test.ts 覆盖。
// 只用工具事件，不让 agent 另写一份说明：intent 是 omp 要求每个工具调用都带的一句话（"i" 参数），结论是 spec 4.9 的结论。
import { relativeToProject, summarizeChanges } from "../conversation/tool-info.ts";
import type { Turn } from "../conversation/model.ts";

interface EditNote {
  toolCallId: string;
  tool: string;
  /** 工具调用的 intent；没有时为 null（界面显示工具名）。 */
  intent: string | null;
  /** 这一次调用的行数；多文件调用或取不到时为 null。 */
  added: number | null;
  removed: number | null;
}

export interface TurnNote {
  turnKey: string;
  /** 轮在对话里的序号（0 起），多个路径写法命中同一文件时按它排回时间顺序。 */
  order: number;
  /** 这一轮用户的请求（第一行），帮助认出是哪一轮。 */
  request: string | null;
  edits: EditNote[];
  /** 这一轮的结论文字；没有结论时为 null。 */
  conclusion: string | null;
}

/** key 是工具参数里的路径（统一成正斜杠），值按轮的先后顺序。 */
export type Explanations = ReadonlyMap<string, TurnNote[]>;

const norm = (path: string) => path.replaceAll("\\", "/");

function firstLine(text: string | undefined): string | null {
  const line = text?.split("\n").find((candidate) => candidate.trim() !== "");
  return line === undefined ? null : line.trim().slice(0, 200);
}

export function explainChanges(turns: readonly Turn[]): Explanations {
  const byFile = new Map<string, TurnNote[]>();
  for (const [order, turn] of turns.entries()) {
    const perFile = new Map<string, EditNote[]>();
    for (const step of turn.steps) {
      if (step.kind !== "tool" || step.status !== "done") continue;
      // summarizeChanges 负责"哪些工具算改动、参数里的路径怎么取"；一次调用一个 step，逐个喂进去拿到该调用的路径和行数。
      for (const change of summarizeChanges([step])) {
        const notes = perFile.get(norm(change.path)) ?? [];
        notes.push({
          toolCallId: step.toolCallId,
          tool: step.name,
          intent: step.intent?.trim() ? step.intent.trim() : null,
          added: change.added,
          removed: change.removed,
        });
        perFile.set(norm(change.path), notes);
      }
    }
    for (const [file, edits] of perFile) {
      const list = byFile.get(file) ?? [];
      list.push({
        turnKey: turn.key,
        order,
        request: firstLine(turn.user?.text),
        edits,
        conclusion: turn.answer && turn.answer.text.trim() !== "" ? turn.answer.text.trim() : null,
      });
      byFile.set(file, list);
    }
  }
  return byFile;
}

/**
 * 评审里的文件路径是相对仓库根的；工具参数里可能是绝对路径，也可能相对任务目录。
 * 先按任务目录换算后精确匹配；工具参数是绝对路径时再按"以 /<路径> 结尾"匹配（任务目录是仓库子目录时两边的根不同）。相对路径只做精确匹配，否则 src/a.ts 会被当成根目录的 a.ts。
 */
export function notesForFile(explanations: Explanations, repoPath: string, taskCwd: string | null): TurnNote[] {
  const target = norm(repoPath);
  const wanted = target.toLowerCase();
  const merged = new Map<string, TurnNote>();
  for (const [file, notes] of explanations) {
    const relative = relativeToProject(file, taskCwd);
    const lower = file.toLowerCase();
    const absolute = /^([a-z]:|\/)/.test(lower);
    const hit =
      (relative !== null && relative.toLowerCase() === wanted) ||
      lower === wanted ||
      (absolute && lower.endsWith(`/${wanted}`));
    if (!hit) continue;
    for (const note of notes) {
      const existing = merged.get(note.turnKey);
      merged.set(note.turnKey, existing ? { ...existing, edits: [...existing.edits, ...note.edits] } : { ...note });
    }
  }
  return [...merged.values()].sort((a, b) => a.order - b.order);
}
