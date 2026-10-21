// 草稿 → 输入框里显示的文本（占位符换成 `#N` 芯片，见 composer-tokens.ts）。
import { useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { buildView, chipLabels, type ChipLabels, type Draft, type DraftView } from "./composer-tokens.ts";

export function useChipLabels(): ChipLabels {
  const t = useT();
  return useMemo(() => chipLabels(t("composer.chip.lines"), t("composer.chip.chars")), [t]);
}

export function useDraftView(draft: Draft): DraftView {
  const labels = useChipLabels();
  return useMemo(() => buildView(draft, labels), [draft, labels]);
}
