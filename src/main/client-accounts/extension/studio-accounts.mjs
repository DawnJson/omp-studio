// studio 内置的 magpie 插件：登录自己的客户端账号，直接用套餐里的模型。
//
// 这个文件是 omp 的扩展，由 omp-studio 写进 `<agent 目录>/extensions/studio-accounts/`（同目录的 index.js 转到这里），
// omp 的每个进程启动时自动加载。
// 设计、实测和风险见 docs/architecture/client-accounts.md；第三方来源见 NOTICE.md。
//
// 每个插件模块里的 `*Plugin` 导出都试一遍：provider id、名字、模型、传输都从插件自己的声明里读；
// 登录方式只有"要打字输入"或"读别的应用的登录"的 provider 会被跳过（见 adapter.mjs 的 pickSignInMethod）。
//
// 另外给 Tavily 搜索装上备用 key（tavily-keys.mjs）：key 用完时同一个请求换下一个重发，并把 agent 目录 `.env` 里的 key 换掉；
// studio 起的进程把 `browser` 工具指到右栏的浏览器面板（studio-browser.mjs）。
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerPluginProviders } from "./shim.mjs";
import { pointBrowserToStudio } from "./studio-browser.mjs";
import { installTavilyBackupKeys } from "./tavily-keys.mjs";
import * as autoclaw from "./vendor/autoclaw/index.mjs";
import * as codearts from "./vendor/codearts/index.mjs";
import * as commandcode from "./vendor/commandcode/index.mjs";
import * as joycode from "./vendor/joycode/index.mjs";
import * as kiro from "./vendor/kiro/index.mjs";
import * as mimo from "./vendor/mimo/index.mjs";
import * as minimax from "./vendor/minimax/index.mjs";
import * as nous from "./vendor/nous/index.mjs";
import * as opendesign from "./vendor/opendesign/index.mjs";
import * as qoder from "./vendor/qoder/index.mjs";
import * as raccoon from "./vendor/raccoon/index.mjs";
import * as trae from "./vendor/trae/index.mjs";
import * as workbuddy from "./vendor/workbuddy/index.mjs";
import * as zcode from "./vendor/zcode/index.mjs";
import * as zed from "./vendor/zed/index.mjs";
import * as zenFree from "./vendor/zen-free/index.mjs";

export default async function studioAccounts(pi) {
  // AutoClaw 把额度记账写在 `${HOME}/.config/magpie/autoclaw-usage.json`；Windows 上通常没有 HOME，路径会落到当前盘的根目录。
  // 这时按它文档里的默认位置（家目录下的 .config/magpie）指给它；用户自己设过这几个变量就不动。
  if (!process.env.HOME && !process.env.XDG_CONFIG_HOME)
    process.env.AUTOCLAW_USAGE_STATE_FILE ??= join(homedir(), ".config", "magpie", "autoclaw-usage.json");
  pointBrowserToStudio(pi);
  installTavilyBackupKeys(
    fileURLToPath(new URL("./tavily-keys.json", import.meta.url)),
    // 扩展在 <agent 目录>/extensions/studio-accounts/ 下。
    fileURLToPath(new URL("../../.env", import.meta.url)),
    pi.logger,
  );
  await registerPluginProviders(
    pi,
    [
      qoder,
      workbuddy,
      trae,
      kiro,
      zed,
      commandcode,
      minimax,
      mimo,
      zcode,
      codearts,
      opendesign,
      joycode,
      raccoon,
      nous,
      autoclaw,
      zenFree,
    ],
    // AutoClaw 的 provider.models 只是原样返回入参，模型表在它的 config 里。
    { staticModels: ["autoclaw"] },
  );
}
