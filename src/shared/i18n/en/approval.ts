import type { MessageEntry } from "../index.ts";
import type { approval as zhCN } from "../zh-CN/approval.ts";

export const approval = {
  title: "Approval mode",
  alwaysAsk: "Ask every time",
  write: "Edits auto, ask before running",
  yolo: "Full auto",
  followOmp: "Follow omp",
  "desc.alwaysAsk": "Reads run automatically; asks before edits and commands",
  "desc.write": "Reads and edits run automatically; asks before commands",
  "desc.yolo": "Never asks",
  "desc.followOmp": "No override: use the tool approval mode from omp's config (omp defaults to full auto)",
  subagents: "Subagents run in the background in full auto and don't ask separately.",
  locked: "Fixed when this task started. Changing the setting only affects new tasks.",
  yoloConfirmTitle: "Use full auto?",
  yoloConfirmBody: "In full auto, omp won't ask before running commands.",
  yoloConfirmYes: "Use full auto",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
