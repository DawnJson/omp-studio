import type { MessageEntry } from "../index.ts";

// 设置 → 用量：订阅账号额度 + 近一年每日消耗热力图。
export const usage = {
  loading: "正在读取…",
  quota: "订阅账号额度",
  "quota.empty": "没有登录订阅账号，或账号没有额度窗口。登录后会显示在这里。",
  "quota.failed": "没能读取额度：{message}",
  "quota.reset": "{time} 重置",
  "quota.used": "已用 {percent}%",
  "quota.unknown": "用量未知",
  "quota.refresh": "刷新",
  "quota.exhausted": "已用尽",
  heatmap: "近一年每日消耗",
  "heatmap.metric": "指标",
  "heatmap.tokens": "Token",
  "heatmap.cost": "花费",
  "heatmap.requests": "请求数",
  "heatmap.syncing": "正在同步 omp 的统计数据…",
  "heatmap.failed": "没能读取统计数据：{message}",
  "heatmap.noDatabase": "omp 还没有统计数据。同步完成后会显示在这里。",
  "heatmap.total": "一年合计 {value}，{days} 天有记录",
  "heatmap.day": "{date}：{value}",
  "heatmap.less": "少",
  "heatmap.more": "多",
  "heatmap.none": "无",
} as const satisfies Record<string, MessageEntry>;
