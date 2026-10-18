import type { MessageEntry } from "../index.ts";
import type { omp as zhCN } from "../zh-CN/omp.ts";

export const omp = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
