// 子代理面板（TSP 任务，spec §4.28）的数据上限：详情里的记录从会话文件读，插话限长。
export const subagentLimits = {
  /** 详情里完整记录的消息条数上限。 */
  detailMessages: 300,
  /** 详情里完整记录的序列化大小上限（字节，近似）。 */
  detailBytes: 8 * 1024 * 1024,
  /** steer 消息的字符上限。 */
  steerChars: 20_000,
} as const;
