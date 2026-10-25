// 命令面板和快捷键里作用在"当前任务的对话"上的两个命令（当前任务的 TspView 显示着时订阅；设置页盖着它（parked）时不订阅）：
//   · copyLast（Ctrl Shift C）：复制最后一条回答的 markdown 原文（shared/tsp/last-answer.ts 从节点树取）；
//   · toggleProcess（Ctrl O）：展开或收起所有工具卡片 = 把 Ctrl+O（`\x0f`）写给 omp。omp 18.12.5 实测：对话里有 bash 工具卡时，
//     一次 Ctrl+O 把卡片的 `collapsed` 从 true 变成 false，再按一次变回 true；思考块（`omp.thinking`）不受影响。
//     studio 的折叠状态跟着程序发来的 `collapsed` 走（use-fold.ts），所以不用自己改。
// 快捷键只在没人处理过这个键（输入框的审批门用 Ctrl+O 当"详情"）、焦点不在终端面板里时生效。
import { useEffect } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { lastAnswerText } from "../../../../shared/tsp/last-answer.ts";
import { useT } from "../../i18n/use-t.ts";
import { primaryMod } from "../../app/platform-keys.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { onStudioCommand } from "../palette/studio-command.ts";
import { peekTspDocument } from "./tsp-store.ts";

/** omp 的 `app.tools.expand`。 */
const CTRL_O = "\x0f";

export function useTaskCommands(taskId: TaskId, parked: boolean): void {
  const t = useT();
  useEffect(() => {
    if (parked) return undefined;
    const copyLast = (): void => {
      const doc = peekTspDocument(taskId);
      const answer = doc === null ? null : lastAnswerText(doc);
      if (answer === null) {
        pushToast({ message: t("cmd.copyLastEmpty") });
        return;
      }
      navigator.clipboard.writeText(answer).then(
        () => pushToast({ message: t("common.copied") }),
        (cause: unknown) => reportError(t, cause),
      );
    };
    const toggleProcess = (): void => {
      window.studio.sendTspKeys(taskId, CTRL_O).catch((cause: unknown) => reportError(t, cause));
    };
    const stop = onStudioCommand((command) => {
      if (command === "copyLast") copyLast();
      else if (command === "toggleProcess") toggleProcess();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || !primaryMod(event)) return;
      if (event.target instanceof Element && event.target.closest('[data-testid="terminal-panel"]') !== null) return;
      const key = event.key.toLowerCase();
      if (key === "c" && event.shiftKey) copyLast();
      else if (key === "o" && !event.shiftKey) toggleProcess();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, [taskId, t, parked]);
}
