// 当前模型的 provider 是不是订阅登录（终端版 omp 在费用后面标 "(sub)"）：该 provider 存了 OAuth 凭据就算。
// omp 选凭据时 OAuth 排在登录存下的 API key 和环境变量之前（omp 文档 providers.md），所以有 OAuth 就是它在用。
// 结果按 provider 缓存 5 分钟：登录、退出之后最多晚这么久体现。读不到（omp 没就绪等）当成不是。
// 模型名在目录里认不出时主进程给的是只显示用的占位模型（provider 为空串，tsp-composer-observer.ts 的 `#resolveModel`）：当成没有 provider。
// 刚启动时先用上次读到的（启动缓存，标成过期），现读的到了再替换。
import { useEffect, useState } from "react";
import { startupSnapshot } from "../../store/startup-snapshot.ts";

const ttlMs = 5 * 60_000;
let cache: Map<string, { value: boolean; at: number }> | null = null;
const inflight = new Map<string, Promise<boolean>>();

function entries(): Map<string, { value: boolean; at: number }> {
  cache ??= new Map(
    Object.entries(startupSnapshot().subscriptions ?? {}).map(([provider, value]) => [provider, { value, at: 0 }]),
  );
  return cache;
}

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
        entries().set(provider, { value, at: Date.now() });
        return value;
      })
      .finally(() => inflight.delete(provider));
    inflight.set(provider, job);
  }
  return job;
}

export function useSubscription(provider: string | null): boolean {
  const known = provider === "" ? null : provider;
  const cached = known === null ? undefined : entries().get(known);
  const [value, setValue] = useState(cached?.value ?? false);
  useEffect(() => {
    if (known === null) {
      setValue(false);
      return;
    }
    const hit = entries().get(known);
    setValue(hit?.value ?? false);
    if (hit !== undefined && Date.now() - hit.at < ttlMs) return;
    let current = true;
    void lookup(known).then((next) => current && setValue(next));
    return () => {
      current = false;
    };
  }, [known]);
  return value;
}
