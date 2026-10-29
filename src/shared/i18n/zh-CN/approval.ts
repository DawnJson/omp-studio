import type { MessageEntry } from "../index.ts";

export const approval = {
  title: "审批模式",
  alwaysAsk: "总是询问",
  alwaysAskCached: "询问并记住",
  write: "自动写入",
  yolo: "全自动",
  "desc.alwaysAsk": "读取自动；写入和执行前询问",
  "desc.alwaysAskCached": "读取、写入和执行前都询问；可记住批准",
  "desc.write": "读取和写入自动；执行命令前询问",
  "desc.yolo": "读取、写入和执行命令都不询问；Subagent 也一样",
  sourceProject: "项目配置",
  sourceGlobal: "全局配置",
  projectLocked: "由项目配置决定（.omp/config.yml）",
  forget: "清除已记住的批准",
  "desc.forget": "所有会话都生效",
  forgetUnavailable: "发出第一条消息后可用",
  yoloConfirmTitle: "使用全自动？",
  yoloConfirmBody: "omp 将不再在执行命令前询问。",
  yoloConfirmYes: "使用全自动",
} satisfies Record<string, MessageEntry>;
