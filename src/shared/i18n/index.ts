// 类型化字典 + t() + Intl。没有 i18n 库：只有中英两种语言，key 在编译期对齐，主进程和渲染进程共用。
// 加文案：先在 zh-CN/<namespace>.ts 里加 key，再在 en/<namespace>.ts 里加同名 key（少一个或多一个都编译失败）。
// 复数：值写成 { one?, other }，t() 用 count 参数和 Intl.PluralRules 选一项；插值写 {name}。
// 运行过程（process、tool 两个命名空间，在 run/ 下）只有一份英文，两种语言共用：和 Tern 里的 omp 一样，
// omp 干活时写出来的东西（Thinking、工具卡片、运行状态行、子代理表、每轮用时与 token）不翻译；其余界面照常翻译。
import type { Locale } from "../ipc.ts";
import { en } from "./en/index.ts";
import { zhCN } from "./zh-CN/index.ts";

/** 一条文案：普通字符串，或按 Intl.PluralRules 类别分开的复数形式（必须有 other）。 */
export type MessageEntry = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);

type Dictionary = typeof zhCN;
type Namespace = keyof Dictionary;

/** `命名空间.key`，如 "shell.appName"。 */
export type MessageKey = { [N in Namespace]: `${N}.${Extract<keyof Dictionary[N], string>}` }[Namespace];

export type MessageParams = Record<string, string | number>;

/** 每种语言的完整字典：namespace → key → 文案。en 用 `satisfies` 对齐 zh-CN 的 key。 */
export const dictionaries: Record<Locale, Record<string, Record<string, MessageEntry>>> = {
  "zh-CN": zhCN,
  en,
};

const pluralRules: Partial<Record<Locale, Intl.PluralRules>> = {};

/** run/ 下的命名空间在两种语言里都是英文：复数也按英文规则选（中文规则永远是 other，会写成 "1 tool calls"）。 */
const englishNamespaces: Partial<Record<string, true>> = { process: true, tool: true };

function pickEntry(locale: Locale, entry: MessageEntry, params: MessageParams | undefined): string {
  if (typeof entry === "string") return entry;
  const count = params?.["count"];
  if (typeof count !== "number") return entry.other;
  const rules = (pluralRules[locale] ??= new Intl.PluralRules(locale));
  return entry[rules.select(count)] ?? entry.other;
}

/** 取文案并代入 {name} 形式的参数。key 缺失（只可能发生在绕过类型检查时）直接返回 key，不吞掉错误。 */
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  // 字典还没有任何 key 时 MessageKey 是 never；按 string 处理才能查表。
  const path: string = key;
  const dot = path.indexOf(".");
  const namespace = path.slice(0, dot);
  const entry = dictionaries[locale][namespace]?.[path.slice(dot + 1)];
  if (entry === undefined) return path;
  const text = pickEntry(englishNamespaces[namespace] ? "en" : locale, entry, params);
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole)) : text;
}

export type TFunction = (key: MessageKey, params?: MessageParams) => string;

/** 绑定语言的 t，给 hook 和主进程的原生对话框用。 */
export function createT(locale: Locale): TFunction {
  return (key, params) => t(locale, key, params);
}
