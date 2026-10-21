// 输入框的几个动作：发送、停止并取回排队消息、压缩上下文。Composer 和命令面板的事件都走这里。
import { reportError } from "../../ui/errors.ts";
import type { PromptImage, TaskId } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { pushToast } from "../dialogs/index.ts";
import { requestStickToBottom } from "../conversation/scroll-bus.ts";
import { endShellRun, getShellRun, startShellRun } from "../conversation/shell-run-store.ts";
import { appendToDraft, getDraft, setDraft } from "./draft-store.ts";
import { stopToasts } from "./stop-outcome.ts";
import { fileToPromptImage } from "./image-resize.ts";
import { canRunShell, isShellDraft } from "./send-logic.ts";
import { findStudioSlash, handledCommands } from "./studio-slash.ts";
import { studioSlashCommands } from "./studio-slash-table.ts";

export type Delivery = "steer" | "followUp";

/**
 * 发送草稿。先清空输入框（乐观），发送失败再放回去并提示；发送后强制吸底。
 * studio 接管的斜杠命令（studio-slash-table.ts）不发给 omp，rpc 和 TSP 任务各有自己能接管的那些（`handledCommands`）；
 * `tsp`（TSP 任务）：别的 `/` `!` 开头的文字原样交给 omp（它自己处理并在过程区里画界面），不走 RPC bash。
 */
export async function sendDraft(
  taskId: TaskId,
  whenBusy: Delivery,
  t: TFunction,
  running: boolean,
  tsp = false,
): Promise<void> {
  const draft = getDraft(taskId);
  const text = draft.text.trim();
  if (text === "" && draft.images.length === 0) return;
  if (!tsp && isShellDraft(draft)) return runShellDraft(taskId, text, t, running);
  const studio =
    draft.images.length === 0 ? findStudioSlash(text, handledCommands(studioSlashCommands, tsp ? "tsp" : "rpc")) : null;
  if (studio !== null) {
    setDraft(taskId, { text: "", images: [] });
    try {
      await studio.command.run(taskId, studio.args, t);
    } catch (error) {
      appendToDraft(taskId, [text], []);
      reportError(t, error);
    }
    return;
  }
  setDraft(taskId, { text: "", images: [] });
  requestStickToBottom(taskId);
  try {
    await window.studio.sendPrompt(taskId, {
      text,
      ...(draft.images.length > 0 ? { images: [...draft.images] } : {}),
      whenBusy,
    });
  } catch (error) {
    appendToDraft(taskId, [text], draft.images);
    reportError(t, error, t("msg.sendFailed"));
  }
}

/**
 * `!命令`（终端版同款）：经 RPC bash 在任务目录里执行，结果以命令块进对话流。
 * `!!`（不进模型上下文）omp 的 bash 命令没有这个选项，不能悄悄当成 `!` 执行：提示并保留草稿。
 * 任务正在跑一轮、或已有一条 `!命令` 在跑时拒绝（提示并保留草稿）：命令块会把正在进行的一轮拦腰截断，
 * 而同一任务同时只有一个命令槽。
 */
async function runShellDraft(taskId: TaskId, text: string, t: TFunction, running: boolean): Promise<void> {
  if (text.startsWith("!!")) {
    pushToast({ level: "warning", message: t("conversation.shell.excludeUnsupported") });
    return;
  }
  const command = text.slice(1).trim();
  if (command === "") return;
  if (!canRunShell({ taskRunning: running, shellRunning: getShellRun(taskId) !== null })) {
    pushToast({ level: "warning", message: t("conversation.shell.busy") });
    return;
  }
  setDraft(taskId, { text: "", images: [] });
  requestStickToBottom(taskId);
  startShellRun(taskId, command);
  try {
    await window.studio.runBash(taskId, command);
  } catch (error) {
    appendToDraft(taskId, [text], []);
    reportError(t, error, t("msg.sendFailed"));
  } finally {
    endShellRun(taskId);
  }
}

/** 停止：撤回排队消息并中止；返回的消息按原文追加回草稿。 */
export async function stopAndRestore(taskId: TaskId, t: TFunction): Promise<void> {
  try {
    const restored = await window.studio.stopTask(taskId);
    const queued = [...restored.steering, ...restored.followUp];
    const images: PromptImage[] = queued.flatMap((item) => item.images ?? []);
    if (queued.length > 0)
      appendToDraft(
        taskId,
        queued.map((item) => item.text),
        images,
      );
    for (const toast of stopToasts(restored)) {
      const message = toast.count === undefined ? t(toast.key) : t(toast.key, { count: toast.count });
      pushToast(toast.level ? { level: toast.level, message } : { message });
    }
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
