// 等一个 promise，最多 ms 毫秒：等进程退出、等启动准备之类"超时就不等了、接着往下走"的地方共用。

/** promise 在 ms 毫秒内结束（成功或失败）返回 true，超时返回 false；永不 reject，到点或结束后清掉定时器。 */
export async function waitWithTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timedOut = Promise.withResolvers<false>();
  const timer = setTimeout(() => timedOut.resolve(false), ms);
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timedOut.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
