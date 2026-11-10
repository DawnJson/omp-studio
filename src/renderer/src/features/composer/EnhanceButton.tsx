// 发送键左边的"优化提示词"（✦）：28×28 图标按钮；优化中 ✦ 形变成 ×（ui/MorphIcon.tsx），再点一次 = 停止（use-prompt-enhance.ts）。
import { useT } from "../../i18n/use-t.ts";
import { IconButton } from "../../ui/controls.tsx";
import { MorphIcon } from "../../ui/MorphIcon.tsx";
import { CLOSE_GLYPH, SPARKLE_GLYPH } from "../../ui/morph-glyphs.ts";
import type { PromptEnhance } from "./use-prompt-enhance.ts";

export function EnhanceButton({ enhance, disabled }: { enhance: PromptEnhance; disabled: boolean }) {
  const t = useT();
  return (
    <IconButton
      label={enhance.busy ? t("composer.enhance.stop") : t("composer.enhance")}
      testId="enhance-button"
      data-busy={enhance.busy ? "" : undefined}
      aria-busy={enhance.busy || undefined}
      disabled={!enhance.busy && (disabled || !enhance.ready)}
      onClick={enhance.toggle}
    >
      <MorphIcon glyph={enhance.busy ? CLOSE_GLYPH : SPARKLE_GLYPH} />
    </IconButton>
  );
}
