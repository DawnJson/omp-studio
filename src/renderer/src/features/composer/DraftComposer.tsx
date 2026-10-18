// 草稿输入框（空状态里的输入框）：还没有任务，发送第一条时才创建任务。
// 胶囊改的是"新任务默认值"（settings 的 defaultModel / defaultThinkingLevel / defaultApprovalMode），没有进程所以不调 setTask*。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { DefaultModelInfo, ModelOption, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { selectTask, useSettings } from "../../store/index.ts";
import { takePendingDraftText } from "../palette/index.ts";
import { convertImageFiles } from "./actions.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, setDraft, setDraftText, useDraft } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { decideEnter } from "./send-logic.ts";
import { SendStop } from "./SendStop.tsx";
import "./composer.css";

const levels: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function DraftComposer({ projectId }: { projectId: ProjectId }) {
  const t = useT();
  const settings = useSettings();
  const key = `new:${projectId}` as TaskId;
  const draft = useDraft(key);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [omp, setOmp] = useState<DefaultModelInfo | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0;

  useEffect(() => {
    window.studio.getDefaultModel().then(setOmp, () => setOmp(null));
    return window.studio.onDefaultModel(setOmp);
  }, []);
  useEffect(() => {
    window.studio.listModels().then(setModels, () => setModels([]));
  }, []);
  useEffect(() => {
    // 命令面板"在新任务中提问"带来的文字：放进草稿并聚焦，不自动发送。
    const pending = takePendingDraftText();
    if (pending !== null) setDraftText(key, pending);
    fieldRef.current?.focus({ preventScroll: true });
  }, [projectId, key]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft.text]);

  const model = (models ?? []).find((m) => m.key.provider === settings?.defaultModel?.provider && m.key.modelId === settings?.defaultModel?.modelId) ?? null;

  const send = async () => {
    const current = getDraft(key);
    const text = current.text.trim();
    if (sending || (text === "" && current.images.length === 0)) return;
    setSending(true);
    try {
      const task = await window.studio.createTask({
        projectId,
        ...(settings?.defaultModel ? { model: settings.defaultModel } : {}),
        ...(settings?.defaultThinkingLevel ? { thinkingLevel: settings.defaultThinkingLevel } : {}),
        ...(settings?.defaultApprovalMode ? { approvalMode: settings.defaultApprovalMode } : {}),
      });
      await selectTask(task.id);
      await window.studio.sendPrompt(task.id, { text, ...(current.images.length > 0 ? { images: [...current.images] } : {}), whenBusy: "steer" });
      setDraft(key, { text: "", images: [] });
    } catch (error) {
      reportError(t, error, t("msg.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const addFiles = async (files: Iterable<File>) => {
    const converted = await convertImageFiles(files, t);
    if (converted.length > 0) {
      const current = getDraft(key);
      setDraft(key, { text: current.text, images: [...current.images, ...converted] });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = decideEnter(
      { key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode },
      { running: false, gate: false, hasContent, swapped: false },
    );
    if (action !== "send") return;
    event.preventDefault();
    void send();
  };
  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addFiles(files);
    }
  };
  const onDrop = (event: DragEvent) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  return (
    <div className="composer-stack" data-testid="draft-composer" data-draft>
      <div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <Attachments images={draft.images} onRemove={(index) => setDraft(key, { text: draft.text, images: draft.images.filter((_, i) => i !== index) })} />
        <textarea
          ref={fieldRef}
          className="composer-field"
          data-composer-input
          data-testid="composer-input"
          rows={2}
          value={draft.text}
          placeholder={t("composer.placeholderNew")}
          aria-label={t("composer.placeholderNew")}
          onChange={(event) => setDraftText(key, event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="composer-tools">
          <button type="button" className="tool-btn" aria-label={t("composer.attach")} title={t("composer.attach")} onClick={() => fileRef.current?.click()}>
            <Plus size={16} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void addFiles(event.target.files ?? []); event.target.value = ""; }} />
          <ModelChip
            model={model}
            thinkingLevel={settings?.defaultThinkingLevel ?? omp?.thinkingLevel ?? null}
            thinkingLevels={levels}
            running={false}
            // 没有指定默认模型时，新任务会用 omp 自己的默认：有可用模型就写"默认模型"，确实一个都没有才是"未连接"。
            {...(omp ? { emptyLabel: omp.name } : models !== null && models.length > 0 ? { emptyLabel: t("composer.defaultModel") } : {})}
            loadModels={() => window.studio.listModels()}
            setModel={(modelKey) => window.studio.setDefaultModel(modelKey)}
            setThinking={(level) => window.studio.setDefaultThinkingLevel(level)}
          />
          <ApprovalChip mode={settings?.defaultApprovalMode ?? null} locked={false} onChange={(mode) => window.studio.setDefaultApprovalMode(mode)} />
          <span className="composer-spacer" />
          <SendStop running={false} stopping={false} hasContent={hasContent} disabled={sending} onSend={() => void send()} onStop={() => undefined} />
        </div>
      </div>
    </div>
  );
}
