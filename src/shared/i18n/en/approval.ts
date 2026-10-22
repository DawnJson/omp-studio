import type { MessageEntry } from "../index.ts";
import type { approval as zhCN } from "../zh-CN/approval.ts";

export const approval = {
  title: "Approval mode",
  alwaysAsk: "Always ask",
  alwaysAskCached: "Ask and remember",
  write: "Write",
  yolo: "Yolo",
  "desc.alwaysAsk": "Reads run automatically; asks before edits and commands",
  "desc.alwaysAskCached": "Asks before reading files, edits and commands; an approval can remember the file or folder",
  "desc.write": "Reads and edits run automatically; asks before commands",
  "desc.yolo": "Never asks",
  sourceProject: "project config",
  sourceGlobal: "global config",
  projectLocked: "Set by the project config (.omp/config.yml)",
  forget: "Forget remembered approvals",
  "desc.forget": "Clears every file and folder approval that Ask and remember has recorded (all sessions)",
  forgetUnavailable: "Available after the first message",
  subagents: "Subagents run in the background in Yolo mode and don't ask separately.",
  loading: "Approval…",
  yoloConfirmTitle: "Use Yolo?",
  yoloConfirmBody: "In Yolo mode, omp won't ask before running commands.",
  yoloConfirmYes: "Use Yolo",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
