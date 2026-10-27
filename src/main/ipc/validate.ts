// IPC 入口校验：发送方校验 + 参数校验工具。渲染进程传来的一切都不可信（AGENTS.md "Electron 安全"）。
// 这里只管"形状"：类型、长度、枚举。"id 是否存在"这类状态校验在各 handler 里做。
import type { IpcMainInvokeEvent } from "electron";
import {
  fontSizeSteps,
  limits,
  type LocalePreference,
  type ModelKey,
  type PromptImage,
  type PromptInput,
  type TaskId,
  type ThemePreference,
  type ProjectId,
} from "../../shared/ipc.ts";
import {
  parseBuiltinCommand,
  parseTaskCommand,
  type BuiltinCommand,
  type TaskCommand,
} from "../../shared/omp-output/index.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import { getMainWindow, isAppUrl } from "../window/main-window.ts";

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(`IPC 参数无效：${message}`);
    this.name = "IpcValidationError";
  }
}

/** 只放行主窗口的顶层页面，并且页面地址是应用自己的。 */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const window = getMainWindow();
  const frame = event.senderFrame;
  if (
    !window ||
    event.sender !== window.webContents ||
    !frame ||
    frame !== event.sender.mainFrame ||
    !isAppUrl(frame.url)
  ) {
    throw new IpcValidationError("发送方不是应用主窗口");
  }
}

export function parseString(
  value: unknown,
  name: string,
  maxChars: number,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") throw new IpcValidationError(`${name} 必须是字符串`);
  if (value.length > maxChars) throw new IpcValidationError(`${name} 超过 ${maxChars} 个字符`);
  if (!options.allowEmpty && value.length === 0) throw new IpcValidationError(`${name} 不能为空`);
  return value;
}

export function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new IpcValidationError(`${name} 必须是布尔值`);
  return value;
}

export function parseInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new IpcValidationError(`${name} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

export function parseOneOf<const T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new IpcValidationError(`${name} 必须是 ${allowed.join(" | ")} 之一`);
  return match;
}

export function parseRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new IpcValidationError(`${name} 必须是对象`);
  return Object.fromEntries(Object.entries(value));
}

// 品牌类型 TaskId/ProjectId 只能靠断言产生；这里是唯一的产生点，id 是否真的存在由 handler 查表确认。
export function parseTaskId(value: unknown): TaskId {
  return parseString(value, "taskId", 200) as TaskId;
}

/** TSP blob 的 id：sha256 十六进制（tsp-session.ts 收 `b` 消息时同样校验），统一成小写（文档里按小写存）。 */
export function parseBlobId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new IpcValidationError("blobId 必须是 64 位十六进制");
  }
  return value.toLowerCase();
}

export function parseProjectId(value: unknown): ProjectId {
  return parseString(value, "projectId", 200) as ProjectId;
}

export function parseTitle(value: unknown): string {
  return parseString(value, "title", limits.titleMaxChars);
}

export function parseLocalePreference(value: unknown): LocalePreference {
  return parseOneOf(value, "locale", ["system", "zh-CN", "en"]);
}

export function parseThemePreference(value: unknown): ThemePreference {
  return parseOneOf(value, "theme", ["system", "light", "dark"]);
}

export function parseFontSize(value: unknown): number {
  const step = fontSizeSteps.find((candidate) => candidate === value);
  if (step === undefined) throw new IpcValidationError(`fontSize 必须是 ${fontSizeSteps.join(" | ")} 之一`);
  return step;
}

export function parseThinkingLevel(value: unknown): ThinkingLevel {
  return parseOneOf(value, "thinkingLevel", ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
}

export function parseMaxLiveProcesses(value: unknown): number {
  const [min, max] = limits.maxLiveProcessesRange;
  return parseInteger(value, "maxLiveProcesses", min, max);
}

export function parseModelKey(value: unknown): ModelKey {
  const record = parseRecord(value, "model");
  return {
    provider: parseString(record["provider"], "model.provider", 200),
    modelId: parseString(record["modelId"], "model.modelId", 500),
  };
}

/** 只放行 http/https；返回规范化后的地址。 */
export function parseExternalUrl(value: unknown): string {
  const url = parseString(value, "url", limits.urlMaxChars);
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:"))
    throw new IpcValidationError("url 只能是 http 或 https");
  return parsed.href;
}

const imageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

function parseImages(value: unknown): PromptImage[] {
  if (!Array.isArray(value)) throw new IpcValidationError("images 必须是数组");
  if (value.length > limits.promptMaxImages) throw new IpcValidationError(`图片最多 ${limits.promptMaxImages} 张`);
  return value.map((item, i) => {
    const record = parseRecord(item, `images[${i}]`);
    const data = parseString(record["data"], `images[${i}].data`, Number.MAX_SAFE_INTEGER);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new IpcValidationError(`images[${i}].data 不是 base64`);
    return { mimeType: parseOneOf(record["mimeType"], `images[${i}].mimeType`, imageMimeTypes), data };
  });
}

function parseFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new IpcValidationError("fileIds 必须是数组");
  if (value.length > limits.promptMaxFiles) throw new IpcValidationError(`文件最多 ${limits.promptMaxFiles} 个`);
  return value.map((item, i) => parseString(item, `fileIds[${i}]`, 64));
}

/** 形状校验：文字长度不限，图片张数和 base64 格式在这里查；文件只收 id（路径在主进程的登记表里）。 */
export function parsePromptInput(value: unknown): PromptInput {
  const record = parseRecord(value, "input");
  const text = parseString(record["text"], "input.text", Number.MAX_SAFE_INTEGER, { allowEmpty: true });
  const images = record["images"] === undefined ? undefined : parseImages(record["images"]);
  const fileIds = record["fileIds"] === undefined ? undefined : parseFileIds(record["fileIds"]);
  if (text.length === 0 && !images?.length) throw new IpcValidationError("消息不能为空");
  return {
    text,
    whenBusy: parseOneOf(record["whenBusy"], "input.whenBusy", ["steer", "followUp"]),
    ...(images && { images }),
    ...(fileIds && { fileIds }),
  };
}

export function parseApiKey(value: unknown): string {
  return parseString(value, "key", limits.apiKeyMaxChars);
}

/** 渲染进程能发给 omp 的 TSP 事件：用户操作和面板状态。`ack`、`error`、`gone` 由主进程的会话自己发。 */
const TSP_RENDERER_EVENTS = [
  "resize",
  "theme",
  "motion",
  "visible",
  "toggle",
  "select",
  "activate",
  "action",
  "change",
  "edit",
  "undo",
  "send",
  "focus",
] as const;

/** 形状校验：事件名在白名单里；字段原样交给 omp（TSP 规范：形状不对的字段 omp 自己忽略）。 */
export function parseTspEvent(value: unknown): TspEvent {
  const record = parseRecord(value, "event");
  parseOneOf(record["ev"], "event.ev", TSP_RENDERER_EVENTS);
  if (record["sf"] !== undefined) parseString(record["sf"], "event.sf", 200);
  return record as unknown as TspEvent;
}

// ───── omp 斜杠命令（command-handlers.ts）：封闭联合类型，形状和字段在 shared/omp-output 里校验 ─────

export function parseTaskCommandArg(value: unknown): TaskCommand {
  try {
    return parseTaskCommand(value);
  } catch (error) {
    throw new IpcValidationError(error instanceof Error ? error.message : String(error));
  }
}

export function parseBuiltinCommandArg(value: unknown): BuiltinCommand {
  try {
    return parseBuiltinCommand(value);
  } catch (error) {
    throw new IpcValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** `null` = 服务进程（用户范围）；否则是项目 id（项目是否存在由 handler 查）。 */
export function parseBuiltinScope(value: unknown): { projectId: ProjectId } | null {
  if (value === null) return null;
  const record = parseRecord(value, "scope");
  return { projectId: parseProjectId(record["projectId"]) };
}
