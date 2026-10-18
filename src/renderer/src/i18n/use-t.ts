// 渲染进程的文案 hook：语言取自主进程解析好的 AppInfo.locale（设置 + 系统语言），还没载入时先按中文。
import { useMemo } from "react";
import { createT, type TFunction } from "../../../shared/i18n/index.ts";
import type { Locale } from "../../../shared/ipc.ts";
import { useAppInfo } from "../store/index.ts";

export function useLocale(): Locale {
  return useAppInfo()?.locale ?? "zh-CN";
}

export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => createT(locale), [locale]);
}
