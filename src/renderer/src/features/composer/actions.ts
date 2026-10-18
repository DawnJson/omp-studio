// 输入框的几个动作：发送、停止并取回排队消息、压缩上下文。Composer 和命令面板的事件都走这里。
import { reportError } from "../../ui/errors.ts";
import type { PromptImage, TaskId } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { pushToast } from "../dialogs/index.ts";
import { requestStickToBottom } from "../conversation/scroll-bus.ts";
import { appendToDraft, getDraft, setDraft } from "./draft-store.ts";
import { fileToPromptImage } from "./image-resize.ts";

export type Delivery = "steer" | "followUp";

/** 发送草稿。先清空输入框（乐观），发送失败再放回去并提示；发送后强制吸底。 */
export async function sendDraft(taskId: TaskId, whenBusy: Delivery, t: TFunction): Promise<void> {
  const draft = getDraft(taskId);
  const text = draft.text.trim();
  if (text === "" && draft.images.length === 0) return;
  setDraft(taskId, { text: "", images: [] });
  requestStickToBottom(taskId);
  try {
    await window.studio.sendPrompt(taskId, { text, ...(draft.images.length > 0 ? { images: [...draft.images] } : {}), whenBusy });
  } catch (error) {
    appendToDraft(taskId, [text], draft.images);
    reportError(t, error, t("msg.sendFailed"));
  }
}

/** 停止：撤回排队消息并中止；返回的消息按原文追加回草稿。 */
export async function stopAndRestore(taskId: TaskId, t: TFunction): Promise<void> {
  try {
    const restored = await window.studio.stopTask(taskId);
    const queued = [...restored.steering, ...restored.followUp];
    const images: PromptImage[] = queued.flatMap((item) => item.images ?? []);
    if (queued.length > 0) appendToDraft(taskId, queued.map((item) => item.text), images);
    if (restored.imagesDropped) pushToast({ level: "warning", message: t("composer.imagesDropped") });
    pushToast({ message: queued.length > 0 ? t("composer.queueRestored", { count: queued.length }) : t("composer.stopped") });
  } catch (error) {
    reportError(t, error);
  }
}

/** 压缩上下文：RPC compact（主进程需要时先拉起进程）。 */
export async function compactContext(taskId: TaskId, t: TFunction): Promise<void> {
  try {
    await window.studio.compactTask(taskId);
  } catch (error) {
    reportError(t, error);
  }
}

/** 把选中/粘贴/拖入的文件转成可发送的图片；非图片 toast 提示，转换失败的跳过。 */
export async function convertImageFiles(files: Iterable<File>, t: TFunction): Promise<PromptImage[]> {
  const list = [...files];
  const images = list.filter((file) => file.type.startsWith("image/"));
  if (images.length < list.length) pushToast({ message: t("composer.attach.imageOnly") });
  const converted: PromptImage[] = [];
  for (const file of images) {
    try {
      converted.push(await fileToPromptImage(file));
    } catch {
      pushToast({ level: "error", message: t("composer.attach.failed") });
    }
  }
  return converted;
}
