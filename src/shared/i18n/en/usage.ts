import type { MessageEntry } from "../index.ts";
import type { usage as zhCN } from "../zh-CN/usage.ts";

export const usage = {
  loading: "Loading…",
  quota: "Subscription quota",
  "quota.empty": "No subscription account is signed in, or it has no quota windows. Signed-in accounts appear here.",
  "quota.failed": "Couldn't read quota: {message}",
  "quota.reset": "resets {time}",
  "quota.used": "{percent}% used",
  "quota.unknown": "Usage unknown",
  "quota.refresh": "Refresh",
  "quota.exhausted": "Exhausted",
  heatmap: "Daily usage, past year",
  "heatmap.metric": "Metric",
  "heatmap.tokens": "Tokens",
  "heatmap.cost": "Cost",
  "heatmap.requests": "Requests",
  "heatmap.syncing": "Syncing omp's statistics…",
  "heatmap.failed": "Couldn't read statistics: {message}",
  "heatmap.noDatabase": "omp has no statistics yet. They appear here once the sync finishes.",
  "heatmap.total": "{value} in the past year, {days} days with activity",
  "heatmap.day": "{date}: {value}",
  "heatmap.less": "Less",
  "heatmap.more": "More",
  "heatmap.none": "None",
} as const satisfies Record<keyof typeof zhCN, MessageEntry>;
