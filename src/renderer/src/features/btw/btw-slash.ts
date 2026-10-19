// `/btw [问题]`：打开旁路提问面板并聚焦输入框；带了问题就直接开一个新话题。不发给模型，也不进主对话流。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { askBtwQuestion } from "./btw-actions.ts";
import { openBtw } from "./btw-ui-store.ts";

export const btwSlash: StudioSlashCommand = {
  name: "btw",
  descKey: "btw.slashDesc",
  async run(taskId, args) {
    openBtw(taskId);
    if (args !== "") await askBtwQuestion(taskId, args, undefined);
  },
};
