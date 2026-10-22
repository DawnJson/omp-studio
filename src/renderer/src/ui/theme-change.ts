// 主题切换（设置里改 data-theme，或跟随系统时系统深浅色变化）的订阅：要按 token 重新取色的地方用它
//（终端的配色、助手画的 svg 图）。返回取消订阅。
export function onThemeChange(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", listener);
  return () => {
    observer.disconnect();
    scheme.removeEventListener("change", listener);
  };
}
