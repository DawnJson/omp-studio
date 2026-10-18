// 错误怎么给用户看：全仓只有这一种做法。翻译规则在 shared/ui/errors.ts（可单测）；这里负责弹 toast。
import { createT, type TFunction } from "../../../shared/i18n/index.ts";
import { describeError, errorDetail } from "../../../shared/ui/errors.ts";
import { currentLocale } from "../store/settings-store.ts";
import { pushToast } from "../features/dialogs/toast-store.ts";

export { describeError, errorDetail };

/**
 * 弹出错误 toast：正文是 describeError，原文放悬停提示。context 是前缀（如"发送失败"），
 * 或一个接收 describeError 结果、返回整句的函数（如 (message) => t("history.resumeFailed", { message })）。
 */
export function reportError(t: TFunction, error: unknown, context?: string | ((message: string) => string)): void {
  const text = describeError(t, error);
  const message = typeof context === "function" ? context(text) : context ? `${context} · ${text}` : text;
  pushToast({ level: "error", message, title: errorDetail(error) });
}

/** 给不在 React 组件里的代码（模块级 store 的后台保存等）用：按当前界面语言弹出。 */
export function reportErrorNow(error: unknown): void {
  reportError(createT(currentLocale()), error);
}
