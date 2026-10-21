// 命令面板和斜杠命令里"别的功能负责执行"的命令：发出方只负责发，负责的功能订阅。
// 例：输入框订阅 stop，TSP 过程区订阅 copyLast / toggleProcess，模型胶囊订阅 model / thinking，外壳订阅 toggleSidebar，
// 费用按钮订阅 usage，上下文圆环订阅 context，待办板订阅 todo，侧栏订阅 rename（给当前任务就地改名）。
// 没人订阅的命令什么也不会发生，所以新增命令时要同时通知对应功能。
export type StudioCommand =
  | "toggleSidebar"
  | "model"
  | "thinking"
  | "stop"
  | "copyLast"
  | "toggleProcess"
  | "usage"
  | "context"
  | "todo"
  | "rename";

const eventName = "studio:command";
const composerTextEvent = "studio:composer-text";

export function emitStudioCommand(command: StudioCommand): void {
  window.dispatchEvent(new CustomEvent<StudioCommand>(eventName, { detail: command }));
}

/** 订阅命令；返回取消订阅函数（直接给 useEffect 返回）。 */
export function onStudioCommand(listener: (command: StudioCommand) => void): () => void {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent) listener(event.detail);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

/** 请输入框把这段文字放进当前草稿并聚焦（命令面板里需要参数的斜杠命令）。 */
export function emitComposerText(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(composerTextEvent, { detail: text }));
}

export function onComposerText(listener: (text: string) => void): () => void {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent) listener(event.detail);
  };
  window.addEventListener(composerTextEvent, handler);
  return () => window.removeEventListener(composerTextEvent, handler);
}

let pendingDraftText: { text: string; expiresAt: number } | null = null;

/** 命令面板"在新任务中提问"：把已输入的文字留给下一个挂载的草稿输入框（startDraft 之后空状态才会渲染它）。 */
export function setPendingDraftText(text: string): void {
  pendingDraftText = { text, expiresAt: Date.now() + 5000 };
}

/** 草稿输入框挂载时调用，取走（只能取一次）待填入的文字；没有或已过期返回 null。 */
export function takePendingDraftText(): string | null {
  const pending = pendingDraftText;
  pendingDraftText = null;
  return pending !== null && pending.expiresAt > Date.now() ? pending.text : null;
}
