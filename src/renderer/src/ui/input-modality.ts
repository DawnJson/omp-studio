// 全应用的"在用键盘还是鼠标"（2026-10-29 仓库所有者定）：<html data-input="keyboard | pointer">。
// 键盘焦点环（:focus-visible 的 outline，颜色 --focus-ring）只在用键盘时画：tokens.css 在 pointer 时把 --focus-ring 设成透明。
// 浏览器自己的 :focus-visible 对程序放的焦点（打开对话框、首屏默认按钮）也会画环；这里统一按最近一次输入判断。
// 启动时算鼠标：还没碰过键盘，首屏的默认焦点不画环。按下非修饰键（含快捷键）算键盘，按下指针（鼠标、触控、笔）算鼠标。
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]);

function setInput(value: "keyboard" | "pointer"): void {
  const root = document.documentElement;
  // 没变就不写属性（写属性会触发样式重算；打字时每个键都会走到这里）。
  if (root.dataset.input !== value) root.dataset.input = value;
}

/** 装一次，整个窗口生命周期有效。 */
export function installInputModality(): void {
  setInput("pointer");
  window.addEventListener(
    "keydown",
    (event) => {
      if (!MODIFIER_KEYS.has(event.key)) setInput("keyboard");
    },
    { capture: true },
  );
  window.addEventListener("pointerdown", () => setInput("pointer"), { capture: true, passive: true });
}

/** 这个元素的焦点是不是键盘带来的：要显示"只给键盘焦点"的东西（悬停提示、平时藏着的工具行）时用它，不直接 matches(":focus-visible")。 */
export function keyboardFocused(element: Element): boolean {
  return document.documentElement.dataset.input === "keyboard" && element.matches(":focus-visible");
}
