import type { MessageEntry } from "../index.ts";

export const approval = {
  title: "审批模式",
  alwaysAsk: "总是询问",
  alwaysAskCached: "询问并记住",
  write: "自动写入",
  yolo: "全自动",
  "desc.alwaysAsk": "读取自动；写入和执行前询问",
  "desc.alwaysAskCached": "读取文件、写入和执行前都询问；批准时可记住这个文件或文件夹",
  "desc.write": "读取和写入自动；执行命令前询问",
  "desc.yolo": "不询问",
  sourceProject: "项目配置",
  sourceGlobal: "全局配置",
  projectLocked: "由项目配置决定（.omp/config.yml）",
  forget: "清除已记住的批准",
  "desc.forget": "清掉“询问并记住”记下的所有文件和文件夹批准（所有会话都生效）",
  subagents: "子代理在后台以全自动运行，不会单独询问。",
  loading: "审批…",
  yoloConfirmTitle: "使用全自动？",
  yoloConfirmBody: "全自动模式下，omp 不会在执行命令前询问你。",
  yoloConfirmYes: "使用全自动",
} satisfies Record<string, MessageEntry>;
