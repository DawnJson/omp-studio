import type { MessageEntry } from "../index.ts";
import type { window as zhCN } from "../zh-CN/window.ts";

export const window = {
  about: "About & feedback",
  aboutOmp: "omp {version}",
  aboutOmpMissing: "omp not found",
  aboutCopyInfo: "Copy version info",
  aboutReportIssue: "Report an issue",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
