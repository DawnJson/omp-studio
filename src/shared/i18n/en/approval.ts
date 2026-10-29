import type { MessageEntry } from "../index.ts";
import type { approval as zhCN } from "../zh-CN/approval.ts";

export const approval = {
  title: "Approval mode",
  alwaysAsk: "Always ask",
  alwaysAskCached: "Ask and remember",
  write: "Write",
  yolo: "Yolo",
  "desc.alwaysAsk": "Reads run automatically; asks before edits and commands",
  "desc.alwaysAskCached": "Asks before reads, edits and commands; can remember approvals",
  "desc.write": "Reads and edits run automatically; asks before commands",
  "desc.yolo": "Never asks before reads, edits or commands; subagents too",
  sourceProject: "project config",
  sourceGlobal: "global config",
  projectLocked: "Set by the project config (.omp/config.yml)",
  forget: "Forget remembered approvals",
  "desc.forget": "Applies to all sessions",
  forgetUnavailable: "Available after the first message",
  yoloConfirmTitle: "Use Yolo?",
  yoloConfirmBody: "omp will no longer ask before running commands.",
  yoloConfirmYes: "Use Yolo",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
