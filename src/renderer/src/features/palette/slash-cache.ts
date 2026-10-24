// 斜杠命令列表的加载规则（纯逻辑，slash-commands.ts 接上 IPC 和 store）：
// 每个键（任务 id 或草稿）同时只有一个请求在飞；拿到非空列表才算"已载入"，之后不再请求（`refresh` 除外：用户开始敲 `/` 时强制再取一次，
// 项目里新建的 skill / 自定义命令不用重启就出现）。
// 空数组（omp 还没就绪）和失败都不记，下次 request 会再取——
// 以前空数组也被记成"已取过"，新建的 TSP 任务里斜杠菜单就永远不出现。
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export interface SlashLoader {
  /** 需要时发请求；返回本次请求结束（成功、空、失败都 resolve，失败已交给 onError）的 promise，没发请求时已 resolve。 */
  request(key: string): Promise<void>;
  /** 已经载入过也再取一次（同一个键有请求在飞时不重复发）。 */
  refresh(key: string): Promise<void>;
  /** 任务删除后丢掉这个键的记录。 */
  forget(key: string): void;
}

export function createSlashLoader(
  fetch: (key: string) => Promise<readonly AvailableSlashCommand[]>,
  publish: (key: string, commands: readonly AvailableSlashCommand[]) => void,
  onError: (error: unknown) => void,
): SlashLoader {
  const done = new Set<string>();
  const inFlight = new Set<string>();
  const load = (key: string): Promise<void> => {
    inFlight.add(key);
    return fetch(key).then(
      (commands) => {
        inFlight.delete(key);
        if (commands.length === 0) return;
        done.add(key);
        publish(key, commands);
      },
      (error: unknown) => {
        inFlight.delete(key);
        onError(error);
      },
    );
  };
  return {
    request: (key) => (done.has(key) || inFlight.has(key) ? Promise.resolve() : load(key)),
    refresh: (key) => (inFlight.has(key) ? Promise.resolve() : load(key)),
    forget: (key) => {
      done.delete(key);
      inFlight.delete(key);
    },
  };
}
