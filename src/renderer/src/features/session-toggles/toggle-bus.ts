// 斜杠命令（/skillful、/computer on 等）要打开输入框上的"会话开关"菜单时发出的请求：发出方只管发，菜单（SessionTogglesMenu）订阅。
import type { TaskId } from "../../../../shared/ipc.ts";

export interface TogglesMenuRequest {
  taskId: TaskId;
  /** 直接停在"开启电脑操作"的确认上（`/computer on`：开启必须先确认）。 */
  confirmComputer: boolean;
}

const eventName = "studio:toggles-menu";

export function requestTogglesMenu(request: TogglesMenuRequest): void {
  window.dispatchEvent(new CustomEvent<TogglesMenuRequest>(eventName, { detail: request }));
}

/** 订阅；返回取消订阅函数（直接给 useEffect 返回）。 */
export function onTogglesMenuRequest(listener: (request: TogglesMenuRequest) => void): () => void {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent) listener(event.detail as TogglesMenuRequest);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
