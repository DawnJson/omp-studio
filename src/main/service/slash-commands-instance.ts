// 斜杠命令列表缓存的单例（slash-commands.ts）：任务目录的列表向该目录的项目 rpc-ui 取，草稿页（没有目录）向服务进程取，
// 都先看缓存。指纹带 studio 版本（studio 自带的扩展随版本变）和 omp 版本（内置命令随版本变）。
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AvailableSlashCommand } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import type { OmpConnection } from "../omp/omp-connection.ts";
import { readyOmpVersion } from "../omp-manager/index.ts";
import { pathKey } from "../tasks/task-registry.ts";
import { inputStamp } from "./input-stamp.ts";
import { projectOmp } from "./project-omp-instance.ts";
import { serviceCwd, serviceOmp } from "./service-omp.ts";
import { SlashCommandCache, slashCommandInputs } from "./slash-commands.ts";
import { startupCache } from "./startup-cache-instance.ts";

let instance: SlashCommandCache | null = null;

/** 第一次用到时才建：启动缓存要等 userData 定下来（index.ts 改 userData 在模块加载之后）。 */
function cache(): SlashCommandCache {
  instance ??= new SlashCommandCache({
    stamp: async (dir) => {
      const home = os.homedir();
      const configRoot = path.resolve(home, process.env["PI_CONFIG_DIR"] || ".omp");
      return inputStamp(
        `${app.getVersion()}+${await readyOmpVersion()}`,
        await slashCommandInputs(dir, resolveAgentDir(), configRoot, home),
      );
    },
    key: pathKey,
    cache: startupCache(),
  });
  return instance;
}

const request = (connection: OmpConnection) => connection.request("get_available_commands");

/** `cwd` 是任务目录（项目 skill、自定义命令、扩展命令都在该目录的项目 rpc-ui 里）；null = 草稿页（服务进程，中性目录）。 */
export async function listSlashCommands(cwd: string | null): Promise<AvailableSlashCommand[]> {
  if (cwd !== null) return cache().list(cwd, async () => (await projectOmp.use(cwd, request)).commands);
  return cache().list(await serviceCwd(), async () => (await serviceOmp.use(request)).commands);
}

/** 项目进程主动推来的列表（握手期间加载完技能 / 扩展、`/reload-plugins` 之后）记进缓存。 */
export function rememberSlashCommands(dir: string, commands: AvailableSlashCommand[]): Promise<void> {
  return cache().remember(dir, commands);
}
