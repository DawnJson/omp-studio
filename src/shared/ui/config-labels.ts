// omp 设置页里的两类文案：枚举设置的可选值、设置键第一段的分组名。纯函数，字典在 i18n 的 ompcfg 命名空间。
import { dictionaries } from "../i18n/index.ts";
import type { Locale } from "../ipc.ts";

function ompcfgEntry(locale: Locale, name: string): string | undefined {
  const value = dictionaries[locale]["ompcfg"]?.[name];
  return typeof value === "string" ? value : undefined;
}

function lookup(locale: Locale, namespace: string, name: string): string | undefined {
  const value = (dictionaries[locale] as Record<string, Record<string, unknown> | undefined>)[namespace]?.[name];
  return typeof value === "string" ? value : undefined;
}

/** omp 设置键第一段的分组名（`prefix.<段>`）；没有翻译的原样首字母大写。 */
export function prefixTitle(locale: Locale, prefix: string): string {
  return ompcfgEntry(locale, `prefix.${prefix}`) ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** 审批模式的值 → 输入框胶囊（approval 命名空间）里同一个模式的文案 key。 */
const approvalModeLabel: Readonly<Record<string, string>> = { "always-ask": "alwaysAsk", write: "write", yolo: "yolo" };
/** 值就是思考强度档位的设置，文案和输入框的思考强度同源（thinking 命名空间）。 */
const thinkingLevelSettings: Readonly<Record<string, true>> = { defaultThinkingLevel: true, "task.maxEffort": true };

/**
 * 枚举设置某个可选值的显示文字。顺序：审批模式用输入框胶囊的文案；思考强度用 thinking；
 * 其次 `<键>.opt.<值>`，再次通用的 `opt.<值>`（on/off/auto 等）；都没有就显示 omp 的原始值。
 */
export function enumLabel(locale: Locale, key: string, value: string): string {
  if (key === "tools.approvalMode" && Object.hasOwn(approvalModeLabel, value)) {
    const label = lookup(locale, "approval", approvalModeLabel[value] ?? "");
    if (label !== undefined) return label;
  }
  if (Object.hasOwn(thinkingLevelSettings, key)) {
    const label = lookup(locale, "thinking", value);
    if (label !== undefined) return label;
  }
  return ompcfgEntry(locale, `${key}.opt.${value}`) ?? ompcfgEntry(locale, `opt.${value}`) ?? value;
}
