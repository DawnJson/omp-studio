// ask：一次 ask 调用的所有问题在同一个门里，一次显示一题。推荐项标"推荐"但不预选；永远有"其他…"自由文本。
// 单选下"其他"和选项互斥；multi 下并存（[推测]：rpc.md 没写，实测前按并存处理，见 docs/architecture/conversation.md）。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AskAnswer } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { DialogRequest } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useAskDraft, type QuestionState } from "./ask-draft-store.ts";
import type { GateBodyProps } from "./Gate.tsx";

const emptyState: QuestionState = { selected: [], otherOn: false, custom: "" };

export function GateAsk({ dialog, busy, respond, primaryRef }: GateBodyProps<Extract<DialogRequest, { kind: "ask" }>>) {
  const t = useT();
  const { questions } = dialog;
  const [draft, updateDraft] = useAskDraft(dialog.id, questions.length);
  const { step, states } = draft;
  const setStep = (next: number) => updateDraft((current) => ({ ...current, step: next }));
  const [hover, setHover] = useState<number | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const customRef = useRef<HTMLInputElement>(null);
  const question = questions[step];
  const state = states[step] ?? emptyState;
  const last = step === questions.length - 1;

  const update = (patch: Partial<QuestionState>) => {
    setShowRequired(false);
    updateDraft((current) => ({ ...current, states: current.states.map((item, index) => (index === step ? { ...item, ...patch } : item)) }));
  };

  const valid = (index: number): boolean => {
    const q = questions[index];
    const s = states[index] ?? emptyState;
    if (!q) return false;
    return q.multi === true || s.selected.length > 0 || (s.otherOn && s.custom.trim() !== "");
  };

  const submit = () => {
    const answers: AskAnswer[] = questions.map((q, index) => {
      const s = states[index] ?? emptyState;
      const custom = s.otherOn && s.custom.trim() !== "" ? s.custom.trim() : null;
      const base: AskAnswer = { id: q.id, selectedOptions: q.options.map((option) => option.label).filter((label) => s.selected.includes(label)) };
      return custom === null ? base : { ...base, customInput: custom };
    });
    respond({ kind: "answers", answers });
  };

  const advance = () => {
    if (busy) return;
    if (!valid(step)) {
      setShowRequired(true);
      return;
    }
    if (last) submit();
    else setStep(step + 1);
  };

  useEffect(() => {
    primaryRef.current = advance;
  });
  useEffect(() => {
    if (state.otherOn) customRef.current?.focus();
  }, [state.otherOn, step]);

  if (!question) return null;
  const multi = question.multi === true;
  const toggle = (label: string) => {
    if (multi) update({ selected: state.selected.includes(label) ? state.selected.filter((item) => item !== label) : [...state.selected, label] });
    else update({ selected: [label], otherOn: false });
  };
  const toggleOther = () => {
    if (multi) update({ otherOn: !state.otherOn });
    else update({ otherOn: true, selected: [] });
  };

  const previewIndex = hover ?? question.options.findIndex((option) => state.selected.includes(option.label));
  const preview = previewIndex >= 0 ? question.options[previewIndex]?.preview : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key !== "Enter" || event.ctrlKey || composing || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    event.stopPropagation();
    advance();
  };

  return (
    <div className="gate-body" onKeyDown={onKeyDown}>
      <div className="gate-ask-meta">
        {questions.length > 1 && <span className="gate-step">{t("gate.step", { i: step + 1, n: questions.length })}</span>}
        {question.header && <span className="gate-chip">{question.header}</span>}
      </div>
      <p className="gate-question">{question.question}</p>
      <div className="gate-list" role={multi ? "group" : "radiogroup"} aria-label={question.question}>
        {question.options.map((option, index) => {
          const checked = state.selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={checked}
              className="gate-row gate-choice"
              data-checked={checked || undefined}
              data-multi={multi || undefined}
              disabled={busy}
              onClick={() => toggle(option.label)}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="gate-mark" aria-hidden="true" />
              <span className="gate-row-text" title={option.description}>
                <span className="gate-row-label">{option.label}</span>
                {option.description && <span className="gate-row-desc">{option.description}</span>}
              </span>
              {question.recommended === index && <span className="gate-chip" data-soft>{t("gate.recommended")}</span>}
            </button>
          );
        })}
        <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={state.otherOn} className="gate-row gate-choice" data-checked={state.otherOn || undefined} data-multi={multi || undefined} disabled={busy} onClick={toggleOther}>
          <span className="gate-mark" aria-hidden="true" />
          <span className="gate-row-text">{t("gate.other")}</span>
        </button>
      </div>
      {state.otherOn && (
        <input ref={customRef} className="gate-input" value={state.custom} placeholder={t("gate.otherPlaceholder")} aria-label={t("gate.other")} disabled={busy} onChange={(event) => update({ custom: event.target.value })} />
      )}
      {preview && <pre className="gate-preview">{preview.split("\n").slice(0, 8).join("\n")}</pre>}
      {showRequired && <p className="gate-required" role="alert">{t("gate.required")}</p>}
      <div className="gate-actions" data-end>
        {step > 0 && (
          <button type="button" className="gate-btn" disabled={busy} onClick={() => setStep(step - 1)}>
            <span className="gate-btn-label">{t("gate.back")}</span>
          </button>
        )}
        <button type="button" className="gate-btn" data-primary disabled={busy} onClick={advance}>
          <span className="gate-btn-label">{last ? t("gate.submit") : t("gate.next")}</span>
          <kbd className="gate-key">{last ? "Ctrl+Enter" : "Enter"}</kbd>
        </button>
      </div>
    </div>
  );
}
