// Shiki(JS 正则引擎，不用 WASM)+ CSS 变量主题：深浅主题不重新高亮，颜色直接取设计 token(tokens.css 里把 --shiki-* 映射到 --syn-*)。
// 分词在 worker 里（highlight-worker.ts）：同步分词一个几百行的文件要 100ms 以上，放在主线程会卡住界面。
// 没高亮完时调用方先显示纯文本，结果到了只改颜色；代码变了、新结果没到时接着用上一次的颜色（highlight-tokens.ts 的 carryHighlight）。
// 排队在主线程：worker 里同时只放 MAX_RUNNING 个请求，其余在这里等；等的时候所有调用方都卸载了（滚过去、折叠、换会话）就直接丢掉，worker 不白算。
// worker 闲下来 IDLE_MS 就关掉（Shiki 和加载过的语言包都在它里面），下次要高亮时重建；主线程的结果缓存不受影响。
import { useEffect, useMemo, useState } from "react";
import type { HighlightReply, HighlightRequest } from "./highlight-worker.ts";
import { resolveLanguage, type Language } from "./highlight-languages.ts";
import { carryHighlight, type HighlightToken } from "./highlight-tokens.ts";

interface Waiter {
  resolve(lines: HighlightToken[][]): void;
  reject(error: unknown): void;
}

/** 一段代码的一次高亮：同一段代码同时只有一个，后来的调用方加进 waiters 等同一个结果。 */
interface Job {
  key: string;
  code: string;
  language: Language;
  waiters: Set<Waiter>;
}

/**
 * 最近用过的结果，总大小超出上限丢最久没用的（Map 按插入顺序，命中时挪到末尾）。按大小不按段数：
 * 一个大文件的预览、评审就能有几万个 token，按段数限会留住几百个这样的结果。
 */
const CACHE_BYTES = 8 * 1024 * 1024;
/** 一个 token 对象连同它的文字大约占的字节数（估算，用来给缓存记账）。 */
const TOKEN_BYTES = 80;
/** 同时交给 worker 的请求数：两个让 worker 算完一个时下一个已经在它的队列里，不用等主线程回一趟。 */
const MAX_RUNNING = 2;
/** worker 没有请求在算、在排队多久后关掉：第一次高亮之后它一直占着几 MB 到十几 MB；重建后重新加载语言包约 100ms，期间显示纯文本。 */
const IDLE_MS = 60_000;

const cache = new Map<string, { lines: HighlightToken[][]; bytes: number }>();
let cacheBytes = 0;
/** 还没出结果的 job（排队的 + 已交给 worker 的），按 cacheKey。 */
const jobs = new Map<string, Job>();
/** 还没交给 worker 的 job，按先来后到。 */
const queued = new Set<Job>();
/** 已交给 worker 的 job，按请求 id。 */
const running = new Map<number, Job>();
let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

function cacheKey(code: string, language: Language): string {
  return `${language}\u0000${code}`;
}

function readCache(key: string): HighlightToken[][] | null {
  const entry = cache.get(key);
  if (entry === undefined) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry.lines;
}

function writeCache(key: string, lines: HighlightToken[][]): void {
  const bytes = key.length * 2 + lines.reduce((sum, line) => sum + line.length, 0) * TOKEN_BYTES;
  cache.set(key, { lines, bytes });
  cacheBytes += bytes;
  // 刚写进的这一段总是留着，哪怕它自己就超过上限。
  for (const [oldest, entry] of cache) {
    if (cacheBytes <= CACHE_BYTES || oldest === key) break;
    cache.delete(oldest);
    cacheBytes -= entry.bytes;
  }
}

function finish(job: Job, outcome: { lines: HighlightToken[][] } | { error: Error }): void {
  jobs.delete(job.key);
  if ("lines" in outcome) writeCache(job.key, outcome.lines);
  for (const waiter of job.waiters) {
    if ("lines" in outcome) waiter.resolve(outcome.lines);
    else waiter.reject(outcome.error);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./highlight-worker.ts", import.meta.url), { type: "module", name: "highlight" });
  worker.addEventListener("message", ({ data }: MessageEvent<HighlightReply>) => {
    const job = running.get(data.id);
    if (!job) return;
    running.delete(data.id);
    finish(job, "error" in data ? { error: new Error(data.error) } : { lines: data.lines });
    pump();
  });
  // worker 脚本没加载起来：排队的和已发出的请求全部失败，下次调用重新建 worker。
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    const error = new Error(event.message || "highlight worker failed");
    const failed = [...running.values(), ...queued];
    running.clear();
    queued.clear();
    for (const job of failed) finish(job, { error });
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function pump(): void {
  clearTimeout(idleTimer);
  while (running.size < MAX_RUNNING) {
    const job = queued.values().next().value;
    if (job === undefined) break;
    queued.delete(job);
    const id = nextId++;
    running.set(id, job);
    const message: HighlightRequest = { id, code: job.code, language: job.language };
    try {
      getWorker().postMessage(message);
    } catch (error) {
      // 建不了 worker（同改版前在 Promise 里调用时一样）：这一段失败，调用方显示纯文本。
      running.delete(id);
      finish(job, { error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  // 没有在算的就没有在排队的（上面的循环会把它们交出去）。
  if (worker !== null && running.size === 0)
    idleTimer = setTimeout(() => {
      worker?.terminate();
      worker = null;
    }, IDLE_MS);
}

/** signal 中止后这个调用方不再等；一段代码的调用方在它交给 worker 前全中止了，就不算了。 */
function highlight(code: string, language: Language, signal: AbortSignal): Promise<HighlightToken[][]> {
  const key = cacheKey(code, language);
  const hit = readCache(key);
  if (hit) return Promise.resolve(hit);
  const job = jobs.get(key) ?? { key, code, language, waiters: new Set<Waiter>() };
  if (!jobs.has(key)) {
    jobs.set(key, job);
    queued.add(job);
  }
  const { promise, resolve, reject } = Promise.withResolvers<HighlightToken[][]>();
  const waiter: Waiter = { resolve, reject };
  job.waiters.add(waiter);
  signal.addEventListener(
    "abort",
    () => {
      job.waiters.delete(waiter);
      reject(signal.reason);
      if (job.waiters.size === 0 && queued.delete(job)) jobs.delete(key);
    },
    { once: true },
  );
  pump();
  return promise;
}

/**
 * 一段代码的高亮 token，按行。lang 是 ```lang / 扩展名之类的写法；传 null（不需要高亮，例如围栏还没闭合）
 * 或认不出的语言时是 null。第一次没高亮完也是 null：调用方先画纯文本，结果到了只改颜色；
 * 之后代码变了、新结果没到时是 carryHighlight 拼出来的过渡结果（不会拿旧 token 盖住新文字）。
 */
export function useHighlighted(code: string, lang: string | null): HighlightToken[][] | null {
  const language = lang === null ? null : resolveLanguage(lang);
  const cached = useMemo(() => (language === null ? null : readCache(cacheKey(code, language))), [code, language]);
  const [done, setDone] = useState<{ code: string; language: Language; lines: HighlightToken[][] } | null>(null);
  useEffect(() => {
    if (language === null || cached !== null) return;
    const controller = new AbortController();
    highlight(code, language, controller.signal).then(
      (lines) => {
        if (!controller.signal.aborted) setDone({ code, language, lines });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) console.error("代码高亮失败", error);
      },
    );
    return () => controller.abort();
  }, [code, language, cached]);
  const carried = useMemo(
    () =>
      cached === null && done !== null && done.language === language && done.code !== code
        ? carryHighlight(done.lines, code)
        : null,
    [cached, done, language, code],
  );
  if (cached !== null) return cached;
  if (done === null || done.language !== language) return null;
  return done.code === code ? done.lines : carried;
}
