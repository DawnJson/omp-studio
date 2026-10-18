/** 剩余毫秒：从主进程收到请求的时间算（receivedAt），组件重挂载或切任务回来都不会重新计时。 */
export function remainingMs(timeoutMs: number, receivedAt: number, now: number): number {
  return Math.max(0, timeoutMs - (now - receivedAt));
}
