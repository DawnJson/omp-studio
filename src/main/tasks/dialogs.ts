// extension_ui_request ↔ DialogRequest / DialogResponse：转换、审批识别、应答校验。
// 渲染进程传来的应答不可信：对照 pending 表里的原始请求逐项校验，通过了才翻译成 omp 的 extension_ui_response。
// 帧的真实形状见 fixtures/rpc/approval-select.ndjson、ask-dialog.ndjson；规则见 docs/architecture/dialogs.md。
import type { DialogRequest, DialogResponse } from "../../shared/ipc.ts";
import type {
  AskUiRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from "../../shared/omp-wire/rpc-wire.generated.ts";

/** 工具审批：RPC 宿主收到的是普通 select，没有结构化字段，按 omp 18.12.1 实录的标题和选项特征判断（没有 title 前缀时按普通 select）。 */
export function isApprovalSelect(title: string, options: readonly string[]): boolean {
  return title.startsWith("Allow tool: ") && options[0] === "Approve" && options[options.length - 1] === "Deny";
}

/** 需要用户回答的 method 才返回请求；notify / setStatus / cancel 等不是对话框。 */
export function toDialogRequest(frame: ExtensionUiRequest): DialogRequest | null {
  switch (frame.method) {
    case "select":
      return {
        id: frame.id,
        kind: "select",
        title: frame.title,
        options: frame.options.map((label, i) => {
          const description = frame.optionDetails?.[i]?.description;
          return description === undefined ? { label } : { label, description };
        }),
        approval: isApprovalSelect(frame.title, frame.options),
        ...(frame.timeout !== undefined && { timeoutMs: frame.timeout }),
      };
    case "confirm":
      return {
        id: frame.id,
        kind: "confirm",
        title: frame.title,
        message: frame.message,
        ...(frame.timeout !== undefined && { timeoutMs: frame.timeout }),
      };
    case "input":
      return {
        id: frame.id,
        kind: "input",
        title: frame.title,
        ...(frame.placeholder !== undefined && { placeholder: frame.placeholder }),
        ...(frame.timeout !== undefined && { timeoutMs: frame.timeout }),
      };
    case "editor":
      return {
        id: frame.id,
        kind: "editor",
        title: frame.title,
        promptStyle: frame.promptStyle ?? false,
        ...(frame.prefill !== undefined && { prefill: frame.prefill }),
      };
    case "ask":
      return {
        id: frame.id,
        kind: "ask",
        questions: frame.questions,
        ...(frame.timeout !== undefined && { timeoutMs: frame.timeout }),
      };
    default:
      return null;
  }
}

export class DialogResponseError extends Error {
  override name = "DialogResponseError";
}

function validateAsk(
  request: AskUiRequest | Extract<DialogRequest, { kind: "ask" }>,
  response: Extract<DialogResponse, { kind: "answers" }>,
): ExtensionUiResponse {
  const { questions } = request;
  if (response.answers.length !== questions.length)
    throw new DialogResponseError(`expected ${questions.length} answers, got ${response.answers.length}`);
  const answers = questions.map((question, i) => {
    const answer = response.answers[i]!;
    if (answer.id !== question.id)
      throw new DialogResponseError(`answer ${i} is for "${answer.id}", expected "${question.id}"`);
    const labels = question.options.map((option) => option.label);
    if (new Set(answer.selectedOptions).size !== answer.selectedOptions.length)
      throw new DialogResponseError(`answer "${answer.id}" repeats an option`);
    for (const selected of answer.selectedOptions) {
      if (!labels.includes(selected)) throw new DialogResponseError(`answer "${answer.id}" selects an unknown option`);
    }
    const customInput = answer.customInput?.trim();
    if (!question.multi) {
      if (answer.selectedOptions.length > 1) throw new DialogResponseError(`question "${answer.id}" is single-select`);
      if (answer.selectedOptions.length === 1 && customInput)
        throw new DialogResponseError(`question "${answer.id}" takes an option or free text, not both`);
    }
    return { id: answer.id, selectedOptions: answer.selectedOptions, ...(customInput && { customInput }) };
  });
  return { type: "extension_ui_response", id: request.id, answers };
}

/** 对照 pending 请求校验应答并翻译成 omp 的 extension_ui_response。校验失败抛 DialogResponseError，请求仍留在 pending 里。 */
export function toUiResponse(request: DialogRequest, response: DialogResponse): ExtensionUiResponse {
  if (response.kind === "cancel") return { type: "extension_ui_response", id: request.id, cancelled: true };
  switch (request.kind) {
    case "select": {
      if (response.kind !== "value") throw new DialogResponseError("select needs a value");
      // select 的值必须是 options 里的原文；omp 对不在其中的值行为未定义，不能让渲染进程伪造。
      if (!request.options.some((option) => option.label === response.value))
        throw new DialogResponseError("value is not one of the options");
      return { type: "extension_ui_response", id: request.id, value: response.value };
    }
    case "confirm":
      if (response.kind !== "confirm") throw new DialogResponseError("confirm needs a boolean");
      return { type: "extension_ui_response", id: request.id, confirmed: response.confirmed };
    case "input":
    case "editor":
      if (response.kind !== "value") throw new DialogResponseError(`${request.kind} needs a value`);
      return { type: "extension_ui_response", id: request.id, value: response.value };
    case "ask":
      if (response.kind !== "answers") throw new DialogResponseError("ask needs answers");
      return validateAsk(request, response);
  }
}
