// 备用模型的思考强度：备用链里的一项是 `provider/model[:档位]`（omp 18.12.6 文档：没有后缀的继承出错那一轮的强度，显式后缀替换它）。
// 只列这个模型支持的档位，数据来源和角色表主模型那一行的思考强度一样（thinkingLevelOptions）。
// 模型页的标签和 `retry.fallbackChains` 编辑器共用。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { joinRoleValue, splitRoleValue } from "../../../../shared/ui/role-value.ts";
import { useT } from "../../i18n/use-t.ts";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { thinkingLabel } from "../composer/thinking-levels.ts";
import { levelsOfSelector, type ModelSources } from "./role-options.ts";

/** 档位的显示文字；omp 支持但这里没有文案的（auto 等）原样显示。 */
export function levelText(t: TFunction, level: string): string {
  const key = thinkingLabel[level as ThinkingLevel];
  return key === undefined ? level : t(key);
}

/**
 * 一个备用模型的思考强度下拉；选了就把 `:档位` 接在选择器后面交给 onChange，选"沿用当前"去掉后缀。
 * 模型不支持思考（也包括非对话模型、`provider/*`）又没有后缀时没有可选的：keepSlot 为 true 画空占位（网格里保持列对齐），否则不画。
 */
export function ChainLevel({
  entry,
  sources,
  name,
  disabled,
  keepSlot = false,
  testId,
  onChange,
}: {
  entry: string;
  sources: ModelSources;
  name: string;
  disabled: boolean;
  keepSlot?: boolean;
  testId: string;
  onChange(next: string): void;
}) {
  const t = useT();
  const { selector, level } = splitRoleValue(entry);
  const levels = levelsOfSelector(selector, sources);
  if (levels.length === 0 && level === null) return keepSlot ? <span /> : null;
  const options: SelectOption<string>[] = [
    { value: "", label: t("settings.roles.thinkingInherit") },
    ...levels.map((entry) => ({ value: entry, label: levelText(t, entry) })),
  ];
  // 配置里的档位这个模型不支持（或模型不在目录里）：原样留着显示，别悄悄显示成别的。
  if (level !== null && !levels.includes(level as ThinkingLevel))
    options.push({ value: level, label: levelText(t, level) });
  return (
    <Select
      size="sm"
      width={104}
      value={level ?? ""}
      options={options}
      label={t("settings.roles.chainThinking", { name })}
      disabled={disabled}
      onChange={(next) => onChange(joinRoleValue(selector, next))}
      testId={testId}
    />
  );
}
