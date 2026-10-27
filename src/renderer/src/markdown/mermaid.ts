// ```mermaid 代码块的图：源码交给 mermaid-worker.ts 画成 SVG 源码，结果按源码缓存（重开任务、切回来不重画）。
// 和高亮不同，这里不排队：一条回答里的图很少，每张图在 worker 里也只要几毫秒（第一张要初始化布局）。
import { useEffect, useState } from "react";
import type { MermaidReply } from "./mermaid-worker.ts";

/** 画好的 SVG 源码，或画不出来的原因（mermaid 写错、beautiful-mermaid 不支持的图种）。 */
export type MermaidResult = { svg: string } | { error: string };

/** 最近用过的结果，超出上限丢最久没用的（Map 按插入顺序，命中时挪到末尾）。 */
const CACHE_LIMIT = 50;

const cache = new Map<string, MermaidResult>();
/** 已交给 worker、还没回来的源码：请求 id 和等结果的调用方。 */
const pending = new Map<string, { id: number; waiters: Set<(result: MermaidResult) => void> }>();
let worker: Worker | null = null;
let nextId = 0;

function finish(source: string, result: MermaidResult): void {
  const job = pending.get(source);
  if (!job) return;
  pending.delete(source);
  cache.set(source, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  for (const waiter of job.waiters) waiter(result);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./mermaid-worker.ts", import.meta.url), { type: "module", name: "mermaid" });
  worker.addEventListener("message", ({ data }: MessageEvent<MermaidReply>) => {
    for (const [source, job] of pending) {
      if (job.id !== data.id) continue;
      finish(source, "svg" in data ? { svg: data.svg } : { error: data.error });
      return;
    }
  });
  // worker 脚本没加载起来：等着的图全部算画不出来（不缓存），下次调用重新建 worker。
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    const failed = [...pending.values()];
    pending.clear();
    for (const job of failed)
      for (const waiter of job.waiters) waiter({ error: event.message || "mermaid worker failed" });
    worker?.terminate();
    worker = null;
  });
  return worker;
}

/** 一段 mermaid 源码画成的图；传 null（不用画，例如围栏还没闭合）或还没画完时是 null。 */
export function useMermaid(source: string | null): MermaidResult | null {
  const [result, setResult] = useState<{ source: string; value: MermaidResult } | null>(null);

  useEffect(() => {
    if (source === null) return;
    const hit = cache.get(source);
    if (hit !== undefined) {
      cache.delete(source);
      cache.set(source, hit);
      setResult({ source, value: hit });
      return;
    }
    const waiter = (value: MermaidResult) => setResult({ source, value });
    let job = pending.get(source);
    if (!job) {
      job = { id: nextId++, waiters: new Set() };
      pending.set(source, job);
      getWorker().postMessage({ id: job.id, source });
    }
    job.waiters.add(waiter);
    const waiters = job.waiters;
    return () => {
      waiters.delete(waiter);
    };
  }, [source]);

  return source !== null && result?.source === source ? result.value : null;
}
