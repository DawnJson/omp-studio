// 配色主题的登记表：设置里能选的主题名、深浅和主进程要用的几种颜色。
// 颜色本身在 src/renderer/styles/tokens.css（light、dark）和 themes.css（其余）里；这里的 sidebar / text / scrim
// 和 CSS 里的 --bg-sidebar / --text / --bg-scrim 必须一致（test/themes.test.ts 核对）。
// 主进程用它：给 nativeTheme 定深浅（omp 的 theme 事件、网页的 prefers-color-scheme 都跟着它），画窗口底色和系统三键。

export interface ThemeSpec {
  dark: boolean;
  /** --bg-sidebar：顶栏和侧栏的底色，也是窗口底色和系统三键的底色。 */
  sidebar: string;
  /** --text：系统三键的符号色。 */
  text: string;
  /** --bg-scrim：有遮罩的弹窗开着时，三键要和盖了遮罩的顶栏同色。 */
  scrim: string;
  /** 有没有自带插图（src/renderer/styles/themes/<名字>.svg，背景图选"主题插图"时画在主区）。 */
  art: boolean;
}

/** 排列顺序就是设置页主题画廊的顺序。 */
export const themes = {
  light: { dark: false, sidebar: "#efefed", text: "#161614", scrim: "rgba(20, 20, 18, 0.32)", art: false },
  dark: { dark: true, sidebar: "#0f0f0e", text: "#e9e9e6", scrim: "rgba(5, 5, 4, 0.56)", art: false },
  "whale-dark": { dark: true, sidebar: "#0a0f1e", text: "#e6ebf7", scrim: "rgba(3, 6, 14, 0.6)", art: true },
  "whale-light": { dark: false, sidebar: "#edf1fa", text: "#121a33", scrim: "rgba(10, 16, 36, 0.32)", art: true },
  sakura: { dark: false, sidebar: "#f9ecf1", text: "#2b1b23", scrim: "rgba(43, 20, 30, 0.3)", art: true },
  "night-sakura": { dark: true, sidebar: "#120d19", text: "#f2e9f2", scrim: "rgba(6, 3, 10, 0.6)", art: true },
  leek: { dark: true, sidebar: "#0a1314", text: "#e2f3f1", scrim: "rgba(2, 8, 8, 0.6)", art: true },
  synthwave: { dark: true, sidebar: "#1a1328", text: "#f6f0ff", scrim: "rgba(8, 4, 16, 0.6)", art: true },
  matrix: { dark: true, sidebar: "#050906", text: "#c8f5cf", scrim: "rgba(0, 4, 1, 0.65)", art: true },
  dracula: { dark: true, sidebar: "#21222c", text: "#f8f8f2", scrim: "rgba(10, 10, 16, 0.6)", art: true },
  "tokyo-night": { dark: true, sidebar: "#16161e", text: "#c0caf5", scrim: "rgba(5, 5, 10, 0.6)", art: true },
  "catppuccin-latte": { dark: false, sidebar: "#e6e9ef", text: "#4c4f69", scrim: "rgba(30, 32, 48, 0.32)", art: true },
  "catppuccin-mocha": { dark: true, sidebar: "#181825", text: "#cdd6f4", scrim: "rgba(10, 10, 18, 0.6)", art: true },
  nord: { dark: true, sidebar: "#272c36", text: "#eceff4", scrim: "rgba(10, 12, 16, 0.6)", art: true },
  "rose-pine": { dark: true, sidebar: "#16141f", text: "#e0def4", scrim: "rgba(8, 6, 14, 0.6)", art: true },
  celadon: { dark: false, sidebar: "#e9efe9", text: "#1b2620", scrim: "rgba(15, 25, 20, 0.3)", art: true },
  ink: { dark: false, sidebar: "#ecebe6", text: "#1a1a18", scrim: "rgba(20, 20, 18, 0.32)", art: true },
  vermilion: { dark: true, sidebar: "#140d0c", text: "#f3e9e2", scrim: "rgba(10, 4, 3, 0.6)", art: true },
} as const satisfies Record<string, ThemeSpec>;

export type ThemeName = keyof typeof themes;
/** system = 跟随系统深浅（light / dark 二选一）。 */
export type ThemePreference = "system" | ThemeName;

export const themeNames = Object.keys(themes) as ThemeName[];

export function isThemeName(value: string): value is ThemeName {
  return Object.hasOwn(themes, value);
}

/** 当前实际用的主题：跟随系统时按系统深浅取 light / dark。 */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ThemeName {
  if (preference !== "system") return preference;
  return systemDark ? "dark" : "light";
}
