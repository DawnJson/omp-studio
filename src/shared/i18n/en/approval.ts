import type { MessageEntry } from "../index.ts";
import type { approval as zhCN } from "../zh-CN/approval.ts";

export const approval = {
  title: "Approval mode",
  alwaysAsk: "Ask every time",
  alwaysAskCached: "Ask and remember",
  write: "Edits auto, ask before running",
  yolo: "Full auto",
  "desc.alwaysAsk": "Reads run automatically; asks before edits and commands",
  "desc.alwaysAskCached": "Asks before reading files, edits and commands; an approval can remember the file or folder",
  "desc.write": "Reads and edits run automatically; asks before commands",
  "desc.yolo": "Never asks",
  sourceProject: "project config",
  sourceGlobal: "global config",
  projectLocked: "Set by the project config (.omp/config.yml)",
  forget: "Forget remembered approvals",
  "desc.forget": "Clears every file and folder approval that Ask and remember has recorded (all sessions)",
  subagents: "Subagents run in the background in full auto and don't ask separately.",
  loading: "Approval…",
  yoloConfirmTitle: "Use full auto?",
  yoloConfirmBody: "In full auto, omp won't ask before running commands.",
  yoloConfirmYes: "Use full auto",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
