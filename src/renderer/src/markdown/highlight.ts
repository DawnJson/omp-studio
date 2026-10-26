// Shiki(JS 正则引擎，不用 WASM)+ CSS 变量主题：深浅主题不重新高亮，颜色直接取设计 token(markdown.css 里把 --shiki-* 映射到 --syn-*)。
// 分词在 worker 里（highlight-worker.ts）：同步分词一个几百行的文件要 100ms 以上，放在主线程会卡住界面。
// 没高亮完时调用方先显示纯文本，结果到了只改颜色。
import type { HighlightReply, HighlightRequest } from "./highlight-worker.ts";
import { resolveLanguage } from "./highlight-languages.ts";

export interface HighlightToken {
  text: string;
  color?: string;
  italic: boolean;
  bold: boolean;
}

interface Pending {
  resolve(lines: HighlightToken[][]): void;
  reject(error: Error): void;
}

const cache = new Map<string, HighlightToken[][]>();
/** 同一段代码正在高亮时，后来的调用等同一个结果，不重复发给 worker。 */
const inFlight = new Map<string, Promise<HighlightToken[][]>>();
const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 0;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./highlight-worker.ts", import.meta.url), { type: "module", name: "highlight" });
  worker.onmessage = ({ data }: MessageEvent<HighlightReply>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if ("error" in data) request.reject(new Error(data.error));
    else request.resolve(data.lines);
  };
  // worker 脚本没加载起来：已发出的请求全部失败，下次调用重新建 worker。
  worker.onerror = (event) => {
    event.preventDefault();
    const error = new Error(event.message || "highlight worker failed");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function tokenize(code: string, language: string): Promise<HighlightToken[][]> {
  const id = nextId++;
  const message: HighlightRequest = { id, code, language };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(message);
  });
}

function cacheKey(code: string, language: string): string {
  return `${language}\u0000${code}`;
}

/** 已经高亮过的结果（同步）；没有时返回 null。 */
export function cachedHighlight(code: string, lang: string): HighlightToken[][] | null {
  const language = resolveLanguage(lang);
  return language ? (cache.get(cacheKey(code, language)) ?? null) : null;
}

export async function highlight(code: string, lang: string): Promise<HighlightToken[][] | null> {
  const language = resolveLanguage(lang);
  if (!language) return null;
  const key = cacheKey(code, language);
  const hit = cache.get(key);
  if (hit) return hit;
  let request = inFlight.get(key);
  if (!request) {
    request = tokenize(code, language).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
  }
  const lines = await request;
  if (cache.size > 200) cache.clear();
  cache.set(key, lines);
  return lines;
}
