// 插件和市场：`omp plugin …` 子命令（只用 CLI，不碰 omp 的磁盘文件）。解析在 src/shared/omp-output/plugins.ts。
// 改动类命令串行执行（omp 会写同一份 lockfile / registry）；读取类命令可以并行。
// 失败（退出码非 0）时抛错，message 是 omp 自己的话（`✘ …` 去掉前缀），界面经 describeError 显示。
import {
  actionMessage,
  parseDiscover,
  parseDoctor,
  parseMarketplaceList,
  parsePluginConfig,
  parsePluginList,
  pluginActionArgs,
  pluginReadArgs,
  type DiscoverEntry,
  type DoctorCheck,
  type PluginAction,
  type PluginConfig,
  type PluginsSnapshot,
} from "../../shared/omp-output/plugins.ts";
import type { RunOmp } from "../usage/usage-service.ts";

class PluginCommandError extends Error {
  override name = "PluginCommandError";
}

/** 成功时返回 stdout；退出码非 0 抛错，带 omp 的原话（stdout 的 `✘` 行或 stderr）。 */
async function runChecked(run: RunOmp, args: string[]): Promise<string> {
  const result = await run(args);
  if (result.code === 0) return result.stdout;
  const message = actionMessage(result.stdout) || actionMessage(result.stderr);
  throw new PluginCommandError(message || `omp ${args.slice(0, 3).join(" ")} exited with code ${result.code}`);
}

export async function listPlugins(run: RunOmp): Promise<PluginsSnapshot> {
  const [list, marketplaces] = await Promise.all([
    runChecked(run, [...pluginReadArgs.list]),
    runChecked(run, [...pluginReadArgs.marketplaces]),
  ]);
  return { ...parsePluginList(list), marketplaces: parseMarketplaceList(marketplaces) };
}

export async function discoverPlugins(run: RunOmp, marketplace: string): Promise<DiscoverEntry[]> {
  return parseDiscover(await runChecked(run, pluginReadArgs.discover(marketplace)));
}

export async function readPluginConfig(run: RunOmp, id: string): Promise<PluginConfig> {
  return parsePluginConfig(await runChecked(run, pluginReadArgs.config(id)));
}

let queue: Promise<unknown> = Promise.resolve();

/** 改动类动作：排队串行。返回 omp 的结果句（界面做 toast）；doctor 在 `checks` 里带检查结果。 */
export function runPluginAction(
  run: RunOmp,
  action: PluginAction,
): Promise<{ text: string; checks: DoctorCheck[] | null }> {
  const job = queue.then(async () => {
    const stdout = await runChecked(run, pluginActionArgs(action));
    if (action.kind === "doctor") return { text: "", checks: parseDoctor(stdout) };
    return { text: actionMessage(stdout), checks: null };
  });
  // 一个动作失败不能卡住后面的。
  queue = job.catch(() => undefined);
  return job;
}
