// 恢复会话时把 history.db 里最新的一条空闲回顾放回它的位置（main 区里，第 `afterTurn` 轮之后、下一轮之前）。
// `userIds` 是文档里 main 的直接子节点中 omp.user 的 id（文档顺序）；`fileTurns` 是会话文件里的轮数。
// 文档轮数 ≥ 文件轮数（文件落后于刚发的新消息）：文档前 afterTurn 轮就是文件前 afterTurn 轮；
// 文档轮数 < 文件轮数（压缩过：omp 恢复时只重发压缩点之后保留的那些轮，实测 compact 会话）：文档是文件的最后几轮，从末尾对齐。
// 对不上（回顾落在没重发的旧轮里）返回 null，不画。

/** 放在 main 末尾。 */
export const RECAP_AT_END = "\u0000end";

/** 回顾放在哪个 omp.user 节点之前（返回它的 id）；`RECAP_AT_END` = 放在 main 末尾；null = 不画。 */
export function recapBefore(userIds: readonly string[], afterTurn: number, fileTurns: number): string | null {
  if (userIds.length === 0 || fileTurns === 0) return null;
  const index = userIds.length >= fileTurns ? afterTurn : afterTurn - (fileTurns - userIds.length);
  if (index < 0) return null;
  return userIds[index] ?? RECAP_AT_END;
}
