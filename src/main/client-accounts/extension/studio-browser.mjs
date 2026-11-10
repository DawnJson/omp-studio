// omp-studio 起的 omp 进程带 `STUDIO_BROWSER_CDP`（任务的浏览器面板的 CDP 口）：把这个进程的 `browser.cdpUrl` 指过去，
// omp 的 `browser` 工具就在 studio 右栏的面板里打开网页。只改内存里的运行时层，不写配置；用户自己配了 `browser.cdpUrl` 就不动。
// 终端里直接跑的 omp 没有这个变量，不受影响。设计见 omp-studio 的 docs/architecture/browser.md。
// 等到 session_start 再改：任务里的 agent 跑的 `omp usage` / `omp models` 等子命令也继承这个变量，它们不初始化设置，
// 加载时读 `pi.pi.settings` 会抛 "Settings not initialized"，整个扩展加载失败，账号插件的 provider 和额度全都不见（omp 18.18.6 实测）。
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

export function pointBrowserToStudio(pi) {
  const url = process.env.STUDIO_BROWSER_CDP;
  if (!url) return;
  pi.on("session_start", () => {
    const setting = lookup("browser.cdpUrl");
    if (setting === undefined || setting.isConfigured(pi.pi.settings)) return;
    setting.override(pi.pi.settings, url);
  });
}
