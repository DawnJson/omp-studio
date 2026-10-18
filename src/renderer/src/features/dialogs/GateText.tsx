// input（单行）和 editor（多行；promptStyle 用正文字体）。IME 组合态 Enter 不提交；editor 用 Ctrl+Enter 提交，没有超时。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import type { DialogRequest } from "../../../../shared/ipc.ts";
import type { GateBodyProps } from "./Gate.tsx";

export function GateText({
  dialog,
  busy,
  respond,
  primaryRef,
}: GateBodyProps<Extract<DialogRequest, { kind: "input" | "editor" }>>) {
  const t = useT();
  const [value, setValue] = useState(dialog.kind === "editor" ? (dialog.prefill ?? "") : "");
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const submit = () => respond({ kind: "value", value });

  useEffect(() => {
    primaryRef.current = submit;
  });
  // 输入类的门出现时光标直接进输入控件（打字中的 1.5 秒规则由外壳处理，外壳没抢焦点时这里也不抢）。
  useEffect(() => {
    const root = fieldRef.current?.closest<HTMLElement>(".gate");
    if (root && document.activeElement === root) fieldRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key !== "Enter" || composing) return;
    if (dialog.kind === "input" || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  };

  return (
    <div className="gate-body">
      {dialog.kind === "input" ? (
        <input
          ref={fieldRef}
          className="gate-input"
          value={value}
          placeholder={dialog.placeholder}
          aria-label={dialog.title}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      ) : (
        <textarea
          ref={fieldRef}
          className="gate-editor"
          data-prompt-style={dialog.promptStyle || undefined}
          value={value}
          aria-label={dialog.title}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
      )}
      <div className="gate-actions" data-end>
        <button type="button" className="gate-btn" disabled={busy} onClick={() => respond({ kind: "cancel" })}>
          <span className="gate-btn-label">{t("gate.cancel")}</span>
          <kbd className="gate-key">Esc</kbd>
        </button>
        <button type="button" className="gate-btn" data-primary disabled={busy} onClick={submit}>
          <span className="gate-btn-label">{dialog.kind === "input" ? t("gate.ok") : t("gate.submit")}</span>
          <kbd className="gate-key">{dialog.kind === "input" ? "Enter" : "Ctrl+Enter"}</kbd>
        </button>
      </div>
    </div>
  );
}
