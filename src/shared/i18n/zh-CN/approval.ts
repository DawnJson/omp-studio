import type { MessageEntry } from "../index.ts";

export const approval = {
  title: "审批模式",
  alwaysAsk: "每次询问",
  write: "写入自动，执行询问",
  yolo: "全部自动",
  "desc.alwaysAsk": "读取自动；写入和执行前询问",
  "desc.write": "读取和写入自动；执行命令前询问",
  "desc.yolo": "不询问",
  subagents: "子代理在后台以全部自动运行，不会单独询问。",
  locked: "这个任务启动时已固定。在设置里修改只影响新任务。",
  yoloConfirmTitle: "使用全部自动？",
  yoloConfirmBody: "全部自动模式下，omp 不会在执行命令前询问你。",
  yoloConfirmYes: "使用全部自动",
} satisfies Record<string, MessageEntry>;
