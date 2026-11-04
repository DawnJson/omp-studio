// 设置 → 通用 → 外观的主题画廊（spec §4.19）：跟随系统 + themeNames 的顺序，每张卡是一个按钮（aria-pressed = 当前主题）。
// 预览块挂 data-theme，就地用那个主题的整套变量画迷你界面（侧栏条、主区底 + 主题插图、你的消息气泡、强调色点），不复制颜色值；
// 跟随系统的预览左右各一半浅色 / 深色。点卡即 setTheme。
// 插图用预先画好的 WebP 缩略图（scripts/make-theme-thumbs.ts），不用主题的 SVG：16 张带模糊滤镜的 SVG 一起栅格化，
// 每次打开设置 GPU 都要卡 300ms 以上，换页的淡入被吞掉（docs/architecture/themes.md「主题画廊的缩略图」）。
import { themeNames, type ThemeName, type ThemePreference } from "../../../../shared/themes.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";

const choices: readonly ThemePreference[] = ["system", ...themeNames];

const thumbFiles = import.meta.glob<string>("../../../styles/themes/thumbs/*.webp", {
  query: "?url",
  import: "default",
  eager: true,
});
/** 主题名 → 缩略图地址；没有插图的主题（浅色、深色）没有。 */
const thumbs = new Map(
  Object.entries(thumbFiles).map(([file, url]) => [file.slice(file.lastIndexOf("/") + 1, -".webp".length), url]),
);

function MiniUi({ theme }: { theme: ThemeName }) {
  const thumb = thumbs.get(theme);
  return (
    <span className="st-theme-mini" data-theme={theme}>
      <span className="st-theme-side" />
      <span className="st-theme-main" style={thumb === undefined ? undefined : { backgroundImage: `url("${thumb}")` }}>
        <span className="st-theme-bubble" />
        <span className="st-theme-dot" />
      </span>
    </span>
  );
}

export function ThemeGallery({ value }: { value: ThemePreference }) {
  const t = useT();
  return (
    <div className="st-theme-gallery" role="group" aria-label={t("settings.theme")} data-testid="theme-gallery">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className="st-theme-card"
          aria-pressed={choice === value}
          onClick={() => void window.studio.setTheme(choice).catch((error: unknown) => reportError(t, error))}
          data-testid={`theme-card-${choice}`}
        >
          <span className="st-theme-preview" aria-hidden="true">
            {choice === "system" ? (
              <>
                <MiniUi theme="light" />
                <MiniUi theme="dark" />
              </>
            ) : (
              <MiniUi theme={choice} />
            )}
          </span>
          <span className="st-theme-name">{t(`settings.theme.${choice}`)}</span>
        </button>
      ))}
    </div>
  );
}
