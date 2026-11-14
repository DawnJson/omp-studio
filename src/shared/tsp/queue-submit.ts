import { focusedAgentName } from "./agent-hub.ts";
import type { TspDocument } from "./document.ts";
import { findMessageTarget } from "./gate.ts";
import { pendingImageCount } from "./image-paste.ts";
import { hasQueuedMessages } from "./queue-restore.ts";
import { findComposerEditor } from "./session-tree.ts";

/** 官方空提交会中断当前轮并处理队列；只向没有草稿或附件的主会话输入框提交。 */
export function queuedSubmitTarget(doc: TspDocument): { sf: string; id: string } | null {
  if (!hasQueuedMessages(doc) || focusedAgentName(doc) !== null || pendingImageCount(doc) > 0) return null;
  const target = findMessageTarget(doc);
  if (target.kind !== "ready" || target.approval || findComposerEditor(doc)?.text !== "") return null;
  return { sf: target.sf, id: target.id };
}
