import type { MessageEntry } from "../index.ts";
import type { window as zhCN } from "../zh-CN/window.ts";

export const window = {
  about: "About & feedback",
  aboutTagline: "A desktop interface for omp",
  feedbackTitle: "Feedback",
  feedbackDesc:
    "Hit a problem or have an idea? Open an issue on GitHub. Attaching diagnostics helps us find the cause faster.",
  exportDiagnostics: "Export diagnostics",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
