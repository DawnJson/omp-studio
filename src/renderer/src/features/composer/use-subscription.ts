// 当前模型的 provider 是不是订阅登录（终端版 omp 在费用后面标 "(sub)"）：该 provider 存了 OAuth 凭据就算。
// omp 选凭据时 OAuth 排在登录存下的 API key 和环境变量之前（omp 文档 providers.md），所以有 OAuth 就是它在用。
// 结果按 provider 缓存 5 分钟：登录、退出之后最多晚这么久体现。读不到（omp 没就绪等）当成不是。
import { useEffect, useState } from "react";

const ttlMs = 5 * 60_000;
const cache = new Map<string, { value: boolean; at: number }>();
const inflight = new Map<string, Promise<boolean>>();

function lookup(provider: string): Promise<boolean> {
  let job = inflight.get(provider);
  if (job === undefined) {
    job = window.studio
      .listAccounts(provider)
      .then(
        (accounts) => accounts.some((account) => account.type === "oauth"),
        () => false,
      )
      .then((value) => {
        cache.set(provider, { value, at: Date.now() });
        return value;
      })
      .finally(() => inflight.delete(provider));
    inflight.set(provider, job);
  }
  return job;
}

export function useSubscription(provider: string | null): boolean {
  const cached = provider === null ? undefined : cache.get(provider);
  const [value, setValue] = useState(cached?.value ?? false);
  useEffect(() => {
    if (provider === null) {
      setValue(false);
      return;
    }
    const hit = cache.get(provider);
    setValue(hit?.value ?? false);
    if (hit !== undefined && Date.now() - hit.at < ttlMs) return;
    let current = true;
    void lookup(provider).then((next) => current && setValue(next));
    return () => {
      current = false;
    };
  }, [provider]);
  return value;
}
