// SQLite worker 的入口（worker_threads）：omp 的 stats.db / agent.db 的只读查询在这里跑，打开库和查询都不占主进程的事件循环。
// 主进程一侧见 db-worker-client.ts。构建时这个文件单独打成一个自包含的 bundle（electron-vite 的 `?modulePath`）：
// 只 import node 内置模块和下面这些不碰 electron、不碰主进程状态的查询函数。
import { parentPort } from "node:worker_threads";
import { readModelPerf } from "../omp-config/model-perf.ts";
import { readSessionTrace } from "../session-info/session-stats.ts";
import { readHeatmap } from "./heatmap.ts";

const reads = {
  heatmap: readHeatmap,
  sessionTrace: readSessionTrace,
  modelPerf: readModelPerf,
};

export type DbReads = typeof reads;
export type DbReadKind = keyof DbReads;

export interface DbRequest {
  id: number;
  kind: DbReadKind;
  args: unknown[];
}

/** 查询抛的错按名字和文字传回（结构化克隆会丢掉自定义错误类的 name，StatsSchemaError 的文字开头要原样到达界面）。 */
export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; name: string; message: string; code: string | undefined };

const port = parentPort;
if (port === null) throw new Error("db-worker.ts must run in a worker thread");

port.on("message", (request: DbRequest) => {
  let response: DbResponse;
  try {
    const read = reads[request.kind] as (...args: unknown[]) => unknown;
    response = { id: request.id, ok: true, value: read(...request.args) };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const code = "code" in failure && typeof failure.code === "string" ? failure.code : undefined;
    response = { id: request.id, ok: false, name: failure.name, message: failure.message, code };
  }
  port.postMessage(response);
});
