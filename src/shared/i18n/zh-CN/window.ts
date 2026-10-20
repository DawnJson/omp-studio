import type { MessageEntry } from "../index.ts";

export const window = {
  about: "关于与反馈",
  aboutTagline: "omp 的桌面界面",
  feedbackTitle: "反馈",
  feedbackDesc: "遇到问题或有想法，去 GitHub 提 Issue；报问题时附上诊断信息会更快定位。",
  exportDiagnostics: "导出诊断信息",
} satisfies Record<string, MessageEntry>;
