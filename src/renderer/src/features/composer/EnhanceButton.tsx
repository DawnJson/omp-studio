// 发送键左边的"优化提示词"（✦）：28×28 图标按钮；优化中换成转圈，再点一次 = 停止（use-prompt-enhance.ts）。
import { useT } from "../../i18n/use-t.ts";
import { Sparkle } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import type { PromptEnhance } from "./use-prompt-enhance.ts";

export function EnhanceButton({ enhance, disabled }: { enhance: PromptEnhance; disabled: boolean }) {
  const t = useT();
  return (
    <IconButton
      className="composer-enhance"
      label={enhance.busy ? t("composer.enhance.stop") : t("composer.enhance")}
      testId="enhance-button"
      data-busy={enhance.busy ? "" : undefined}
      aria-busy={enhance.busy || undefined}
      disabled={!enhance.busy && (disabled || !enhance.ready)}
      onClick={enhance.toggle}
    >
      {enhance.busy ? <span className="composer-enhance-spin" aria-hidden="true" /> : <Sparkle />}
    </IconButton>
  );
}
