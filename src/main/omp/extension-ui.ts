// rpc-ui 的 extension_ui_request 里，studio 的后台进程不会渲染的那部分怎么处理（docs/architecture/omp-rpc.md）。
// 登录（service/login.ts）和连接层的常驻默认应答共用这里的判断：不共用就会有两套"哪些要回 cancelled"。
import type { CancelUiResponse, ExtensionUiRequest } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { log } from "../log/log.ts";

/** 后台进程没有人能回答 select / confirm / input / editor / ask：应答 cancelled，否则 omp 里发请求的一侧会一直等。其它方法返回 null（不需要应答）。 */
export function cancelledReply(frame: ExtensionUiRequest): CancelUiResponse | null {
  switch (frame.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
    case "ask":
      return { type: "extension_ui_response", id: frame.id, cancelled: true };
    default:
      return null;
  }
}

const LOG_TEXT_MAX = 200;
const clip = (text: string) => (text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}…` : text);

/** 只写日志的呈现类请求（日志写入时会再脱敏）。 */
export function logPresentationRequest(frame: ExtensionUiRequest): void {
  switch (frame.method) {
    case "notify":
      log.info(`omp extension notify (${frame.notifyType ?? "info"}): ${clip(frame.message)}`);
      break;
    case "setStatus":
      log.info(`omp extension setStatus ${frame.statusKey}: ${clip(frame.statusText ?? "")}`);
      break;
    case "setWidget":
      log.info(`omp extension setWidget ${frame.widgetKey}: ${clip((frame.widgetLines ?? []).join(" | "))}`);
      break;
    default:
      break;
  }
}
