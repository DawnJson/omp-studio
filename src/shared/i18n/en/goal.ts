import type { MessageEntry } from "../index.ts";
import type { goal as zhCN } from "../zh-CN/goal.ts";

export const goal = {
  title: "Goal",
  slashDesc: "Set a goal; omp keeps working until it is done. Without text, shows the current goal",
  pause: "Pause",
  resume: "Resume",
  completed: "Goal complete",
  drop: "Drop",
  cmdPause: "Pause goal",
  cmdResume: "Resume goal",
  cmdDrop: "Drop goal",
  "status.active": "Active",
  "status.paused": "Paused",
  "status.budget-limited": "Budget used up",
  usageTitle: "{used} tokens used",
  usageBudgetTitle: "{used} of {budget} tokens used",
  current: "Current goal ({status}): {objective}",
  none: "No goal right now. Use /goal followed by the goal text to set one",
  autoContinueOff: "The goal won't keep going on its own. Turn on “Let goals keep going” in Settings → General",
  openSettings: "Open settings",
  pauseFailed: "Couldn't pause the goal",
  resumeFailed: "Couldn't resume the goal",
  dropFailed: "Couldn't drop the goal",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
