import type { MessageEntry } from "../index.ts";
import type { composer as zhCN } from "../zh-CN/composer.ts";

export const composer = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
