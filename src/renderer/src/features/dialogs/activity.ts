// 门出现时要知道用户"刚才有没有在打字"（spec 4.17：1.5 秒内有按键就不抢焦点）。
let lastKeyAt = 0;

export function startKeyActivityTracking(): void {
  window.addEventListener("keydown", () => (lastKeyAt = Date.now()), { capture: true });
}

export function msSinceLastKey(): number {
  return Date.now() - lastKeyAt;
}
