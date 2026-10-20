// 用量行（omp.turn.usage）给它的子文字提供这一轮的准确费用（turn-cost.ts）；不在用量行里是 undefined。
import { createContext } from "react";

export const TurnCostCtx = createContext<number | undefined>(undefined);
