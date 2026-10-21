import type { MessageEntry } from "../index.ts";

export const window = {
  about: "关于与反馈",
  aboutVersion: "版本 {version}",
  aboutOmp: "omp {version}",
  aboutOmpMissing: "未找到 omp",
  aboutCopyInfo: "复制版本信息",
  aboutReportIssue: "报告问题",
} satisfies Record<string, MessageEntry>;
