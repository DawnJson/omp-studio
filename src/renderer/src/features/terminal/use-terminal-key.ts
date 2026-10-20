// 新任务草稿的终端键（草稿的项目见 useDraftProject）；选中任务时终端键就是任务 id。
import { draftKey, type DraftKey } from "../../../../shared/ipc.ts";
import { useDraftProject } from "../empty/use-draft-project.ts";

export function useDraftTerminalKey(): DraftKey {
  return draftKey(useDraftProject()?.id ?? null);
}
