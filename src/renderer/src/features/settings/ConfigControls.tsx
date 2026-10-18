// omp 设置项的控件：按类型选（开关、下拉/分段、数字框、文本框、JSON 编辑器）。修改即保存：开关和选择立即存，
// 文本类输入停手 700 ms（JSON 1000 ms）、失焦或按 Enter 时存；校验没过不存，错误就地显示。
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Segmented, Select, Switch, type Option } from "./controls.tsx";
import { canEditStructured, ChainsEditor, RolesEditor } from "./StructuredEditors.tsx";

export interface ControlProps {
  item: OmpConfigItem;
  labelId: string;
  /** 通过校验的新值，交给主进程保存。 */
  onSave(value: unknown): void;
  /** 本地校验结果：null 表示没问题。 */
  onInvalid(message: string | null): void;
}

const textDelayMs = 700;
const jsonDelayMs = 1000;

/** 文本类输入的草稿：外部值变了（保存成功、恢复默认）就同步；停手、失焦、Enter 时提交；卸载时把没提交的草稿提交掉。 */
function useDraft(serialized: string, delayMs: number, commit: (text: string) => void) {
  const [draft, setDraft] = useState(serialized);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    // 还有没提交的输入时，别用保存结果覆盖用户正在打的字。
    if (timer.current !== undefined) return;
    latest.current = serialized;
    setDraft(serialized);
  }, [serialized]);

  const flush = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    commitRef.current(latest.current);
  };
  const change = (text: string) => {
    latest.current = text;
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
  };
  useEffect(() => flush, []);
  return { draft, change, flush };
}

function NumberControl({ item, labelId, onSave, onInvalid }: ControlProps) {
  const t = useT();
  const serialized = item.hasValue && typeof item.value === "number" ? String(item.value) : "";
  const { draft, change, flush } = useDraft(serialized, textDelayMs, (text) => {
    if (text === serialized) return onInvalid(null);
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) return onInvalid(t("settings.cfg.invalidNumber"));
    onInvalid(null);
    onSave(parsed);
  });
  return (
    <input
      className="st-input cfg-number"
      inputMode="decimal"
      spellCheck={false}
      value={draft}
      placeholder={t("settings.cfg.unset")}
      aria-labelledby={labelId}
      onChange={(event: ChangeEvent<HTMLInputElement>) => change(event.target.value)}
      onBlur={flush}
      onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && flush()}
    />
  );
}

function StringControl({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const serialized = item.hasValue && typeof item.value === "string" ? item.value : "";
  const { draft, change, flush } = useDraft(serialized, textDelayMs, (text) => {
    if (text !== serialized) onSave(text);
  });
  return (
    <input
      className="st-input cfg-string"
      spellCheck={false}
      value={draft}
      placeholder={t("settings.cfg.unset")}
      aria-labelledby={labelId}
      onChange={(event: ChangeEvent<HTMLInputElement>) => change(event.target.value)}
      onBlur={flush}
      onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && flush()}
    />
  );
}

function JsonControl({ item, labelId, onSave, onInvalid }: ControlProps) {
  const t = useT();
  const empty = item.type === "array" ? "[]" : "{}";
  const serialized = item.hasValue ? JSON.stringify(item.value, null, 2) : empty;
  const { draft, change, flush } = useDraft(serialized, jsonDelayMs, (text) => {
    if (text === serialized) return onInvalid(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return onInvalid(
        t("settings.cfg.invalidJson", { message: error instanceof Error ? error.message : String(error) }),
      );
    }
    const isArray = Array.isArray(parsed);
    if (item.type === "array" && !isArray) return onInvalid(t("settings.cfg.expectArray"));
    if (item.type === "record" && (isArray || typeof parsed !== "object" || parsed === null))
      return onInvalid(t("settings.cfg.expectObject"));
    onInvalid(null);
    if (JSON.stringify(parsed) !== JSON.stringify(item.value)) onSave(parsed);
  });
  const rows = Math.min(12, Math.max(2, draft.split("\n").length));
  return (
    <textarea
      className="st-input cfg-json"
      spellCheck={false}
      rows={rows}
      value={draft}
      aria-labelledby={labelId}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => change(event.target.value)}
      onBlur={flush}
    />
  );
}

function EnumControl({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const current = typeof item.value === "string" ? item.value : "";
  const base: Option<string>[] = (item.options ?? []).map((option) => ({ value: option, label: option }));
  // 当前值不在可选值里（omp 版本变了、手改过配置）：保留它，别让控件悄悄显示成别的。
  if (item.hasValue && current !== "" && !base.some((option) => option.value === current))
    base.push({ value: current, label: current });
  const short = base.length <= 3 && base.every((option) => option.label.length <= 12) && item.hasValue;
  if (short) return <Segmented<string> value={current} options={base} labelledBy={labelId} onChange={onSave} />;
  const options = item.hasValue ? base : [{ value: "", label: t("settings.cfg.unset") }, ...base];
  return (
    <Select<string>
      value={current}
      options={options}
      labelledBy={labelId}
      onChange={(next) => next !== "" && onSave(next)}
    />
  );
}

/** 按 omp 给的类型选控件；凭据另外处理（ConfigRow）。 */
export function ConfigControl(props: ControlProps) {
  const { item, labelId, onSave } = props;
  switch (item.type) {
    case "boolean":
      return <Switch checked={item.value === true} labelledBy={labelId} onChange={onSave} />;
    case "enum":
      return item.options ? <EnumControl {...props} /> : <StringControl {...props} />;
    case "number":
      return <NumberControl {...props} />;
    case "string":
      return <StringControl {...props} />;
    case "array":
    case "record":
      if (item.key === "modelRoles" && canEditStructured(item)) return <RolesEditor {...props} />;
      if (item.key === "retry.fallbackChains" && canEditStructured(item)) return <ChainsEditor {...props} />;
      return <JsonControl {...props} />;
  }
}
