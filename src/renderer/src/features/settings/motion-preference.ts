// "减少动效"：设置存在主进程（StudioSettings.reduceMotion），这里把它落到 <html data-motion="reduced">。
// 只能强制开启；系统要求减少动效时 tokens.css 的媒体查询始终生效，不受它影响。
// 在设置页模块 import 时就订阅（App 一直 import 设置页），启动时和设置变化时都应用。
function apply(on: boolean): void {
  if (on) document.documentElement.dataset["motion"] = "reduced";
  else delete document.documentElement.dataset["motion"];
}

/** 系统层面已要求减少动效。 */
export function systemReducesMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

window.studio.onSettings((settings) => apply(settings.reduceMotion));
window.studio.getSettings().then(
  (settings) => apply(settings.reduceMotion),
  (error: unknown) => console.error("getSettings 失败（减少动效）", error),
);
