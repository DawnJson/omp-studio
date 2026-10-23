// omp 的通知设置（`ask.notify` / `completion.notify` / `error.notify`，取值 `on` | `off`）决定 studio 发不发对应的系统通知：
// 设置页里这三项就是 omp 的设置（和终端共用），studio 不另存一个开关。默认值（omp 18.12.6）：ask 开、completion 开、error 关。
// 从 `omp config list --json` 的结果读（项目 `.omp/config.yml` 盖过全局的规则由 omp 自己处理，在项目目录里跑就是生效值）。
import { valueOf } from "./model-defaults.ts";

export type NotifyKind = "ask" | "completion" | "error";

const notifyKeys: Readonly<Record<NotifyKind, string>> = {
  ask: "ask.notify",
  completion: "completion.notify",
  error: "error.notify",
};

const notifyDefaults: Readonly<Record<NotifyKind, boolean>> = { ask: true, completion: true, error: false };

/** 这一类通知开着没有：值是 `on` / `off`；没有这个键（读不到）或认不出的值，用 omp 的默认。 */
export function notifyEnabled(listed: unknown, kind: NotifyKind): boolean {
  const value = valueOf(listed, notifyKeys[kind]);
  if (value === "on") return true;
  if (value === "off") return false;
  return notifyDefaults[kind];
}
