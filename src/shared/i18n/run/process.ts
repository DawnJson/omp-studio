// 运行过程的文案（两种语言共用这一份英文）：过程区、运行状态行、子代理表、每轮的用时与 token。
// 和 Tern 里的 omp 一样，omp 干活时写出来的东西保持英文；界面上的按钮、输入框、提示、设置照常翻译（见 ../index.ts）。
import type { MessageEntry } from "../index.ts";

export const process = {
  thoughtShort: "Thinking",
  earlier: "{n} earlier",
} satisfies Record<string, MessageEntry>;
