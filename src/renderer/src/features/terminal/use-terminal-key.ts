// 当前主区对应的终端键：选中任务时是任务 id，否则是新任务草稿的键（草稿的项目见 useDraftProject）。
import { draftKey, type DraftKey, type TerminalKey } from "../../../../shared/ipc.ts";
import { useDraftProject } from "../empty/use-draft-project.ts";
import { useSelectedTaskId } from "../../store/index.ts";

export function useDraftTerminalKey(): DraftKey {
  return draftKey(useDraftProject()?.id ?? null);
}

export function useTerminalKey(): TerminalKey {
  const taskId = useSelectedTaskId();
  const draft = useDraftTerminalKey();
  return taskId ?? draft;
}
