// 门停靠在输入框上方：Composer 渲染这个槽，DialogLayer 把门 portal 进来。
// 这样 App.tsx 里 DialogLayer 保持"只收 taskId"的约定，门又和输入框在同一个底部栈里同宽同轴。
import { createStore, useStoreValue } from "../../store/create-store.ts";

const slotStore = createStore<HTMLElement | null>(null);

export function GateSlot() {
  return <div className="gate-slot" data-testid="gate-slot" ref={(element) => slotStore.set(element)} />;
}

export function useGateSlot(): HTMLElement | null {
  return useStoreValue(slotStore, (state) => state);
}
