import type { MessageEntry } from "../index.ts";
import type { palette as zhCN } from "../zh-CN/palette.ts";

export const palette = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
