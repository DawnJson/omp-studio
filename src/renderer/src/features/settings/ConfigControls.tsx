// omp 设置项的控件，按类型选（spec §4.19，direction-3.2 §4 第 3 条）：
//   布尔 → Switch；枚举 ≤4 个值 → Segmented，更多 → Select（只看个数，不看语言和宽度）；数字 → NumberField（单位从 key 后缀推）；
//   字符串 → TextField；字符串数组 → TagInput；对象和其余 JSON → "编辑…"按钮 + 等宽摘要，点开对话框编辑并校验。
// 修改即保存：开关、选择、标签增删立即存；文本和数字停手 700 ms、失焦或按 Enter 时存；校验没过不存，错误就地显示。
import { useEffect, useMemo, useRef, useState } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { enumLabel } from "../../../../shared/ui/config-labels.ts";
import {
  goalContinuationKey,
  goalContinuationOn,
  withGoalContinuation,
} from "../../../../shared/ui/goal-continuation.ts";
import { Button, NumberField, Segmented, Switch, Textarea, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Select } from "../../ui/Select.tsx";
import { configText, numberSpecial, numberUnit, shortValue, type NumberUnit } from "./config-meta.ts";
import { canEditStructured, ChainsEditor, RolesEditor, structuredSummary } from "./StructuredEditors.tsx";
import { TagInput } from "./TagInput.tsx";

export interface ControlProps {
  item: OmpConfigItem;
  labelId: string;
  /** 这一行的名字（人话标签或 key），对话框标题用。 */
  title: string;
  /** 通过校验的新值，交给主进程保存。 */
  onSave(value: unknown): void;
  /** 本地校验结果：null 表示没问题。 */
  onInvalid(message: string | null): void;
}

const textDelayMs = 700;
/** 枚举最多这么多个值用分段，超过就用下拉。 */
const maxSegments = 4;

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

function unitText(unit: NumberUnit | null, t: TFunction): string | undefined {
  if (unit === "ms") return "ms";
  if (unit === "percent") return "%";
  if (unit === "seconds") return t("settings.unit.seconds");
  return undefined;
}

function NumberControl({ item, labelId, onSave, onInvalid }: ControlProps) {
  const t = useT();
  const locale = useLocale();
  const special = numberSpecial(locale, item.key);
  const isSpecial = special !== null && item.hasValue && item.value === special.value;
  const serialized = item.hasValue && typeof item.value === "number" && !isSpecial ? String(item.value) : "";
  const { draft, change, flush } = useDraft(serialized, textDelayMs, (text) => {
    if (text === serialized) return onInvalid(null);
    onInvalid(null);
    // 特殊值（-1 / 0）在框里是空的、显示占位文字：清空 = 存回这个值。
    if (text.trim() === "" && special !== null) {
      if (!isSpecial) onSave(special.value);
      return;
    }
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) return onInvalid(t("settings.cfg.invalidNumber"));
    onSave(parsed);
  });
  return (
    <NumberField
      size="sm"
      value={draft}
      unit={unitText(numberUnit(item.key), t)}
      placeholder={special !== null && (isSpecial || item.hasValue) ? special.placeholder : t("settings.cfg.unset")}
      aria-labelledby={labelId}
      onChange={change}
      onBlur={flush}
      onKeyDown={(event) => event.key === "Enter" && flush()}
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
    <TextField
      size="sm"
      width={260}
      value={draft}
      placeholder={t("settings.cfg.unset")}
      aria-labelledby={labelId}
      onChange={change}
      onBlur={flush}
      onKeyDown={(event) => event.key === "Enter" && flush()}
    />
  );
}

type JsonResult = { value: unknown } | { error: string };

function parseJson(text: string, type: OmpConfigItem["type"], t: TFunction): JsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      error: t("settings.cfg.invalidJson", { message: error instanceof Error ? error.message : String(error) }),
    };
  }
  const isArray = Array.isArray(parsed);
  if (type === "array" && !isArray) return { error: t("settings.cfg.expectArray") };
  if (type === "record" && (isArray || typeof parsed !== "object" || parsed === null))
    return { error: t("settings.cfg.expectObject") };
  return { value: parsed };
}

/** 行内的"编辑…"按钮 + 等宽摘要；点开是一个对话框，内容由调用方给。 */
function EditButton({ summary, onOpen, title }: { summary: string; onOpen(): void; title: string }) {
  const t = useT();
  return (
    <>
      <Button size="sm" onClick={onOpen}>
        {t("settings.cfg.edit")}
      </Button>
      <span className="st-summary" title={title}>
        {summary}
      </span>
    </>
  );
}

function JsonControl({ item, title, onSave }: ControlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const empty = item.type === "array" ? "[]" : "{}";
  const current: unknown = item.hasValue ? item.value : JSON.parse(empty);
  const result = useMemo(() => parseJson(draft, item.type, t), [draft, item.type, t]);
  const error = "error" in result ? result.error : null;
  const unchanged = "value" in result && JSON.stringify(result.value) === JSON.stringify(current);
  return (
    <>
      <EditButton
        summary={item.hasValue ? shortValue(item.value, 40) : empty}
        title={shortValue(current, 400)}
        onOpen={() => {
          setDraft(JSON.stringify(current, null, 2));
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        desc={<span className="st-mono">{item.key}</span>}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={error !== null || unchanged}
              onClick={() => {
                if ("value" in result) onSave(result.value);
                setOpen(false);
              }}
              testId="cfg-json-save"
            >
              {t("settings.cfg.save")}
            </Button>
          </>
        }
        testId="cfg-json-dialog"
      >
        <Textarea
          mono
          rows={14}
          value={draft}
          invalid={error !== null}
          onChange={setDraft}
          aria-label={title}
          data-autofocus=""
          testId="cfg-json-text"
        />
        {error !== null && (
          <p className="ui-help" data-tone="error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

/** modelRoles、retry.fallbackChains：不让用户手写 JSON，对话框里是专门的编辑器（改动立即保存）。 */
function StructuredControl(props: ControlProps) {
  const { item, title } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const Editor = item.key === "modelRoles" ? RolesEditor : ChainsEditor;
  return (
    <>
      <EditButton
        summary={structuredSummary(item, t)}
        title={shortValue(item.hasValue ? item.value : {}, 400)}
        onOpen={() => setOpen(true)}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        desc={<span className="st-mono">{item.key}</span>}
        footer={
          <Button variant="primary" onClick={() => setOpen(false)} data-autofocus="">
            {t("settings.cfg.done")}
          </Button>
        }
        testId="cfg-structured-dialog"
      >
        <Editor {...props} />
      </Dialog>
    </>
  );
}

function EnumControl({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const locale = useLocale();
  // 有人话标签的常用项显示翻译过的取值；其余（高级页）原样显示 omp 的取值，用等宽字。
  const human = configText(locale, item).label !== null;
  const current = typeof item.value === "string" ? item.value : "";
  const label = (value: string) => (human ? enumLabel(locale, item.key, value) : value);
  const options: Option<string>[] = (item.options ?? []).map((option) => ({ value: option, label: label(option) }));
  // 当前值不在可选值里（omp 版本变了、手改过配置）：保留它，别让控件悄悄显示成别的。
  if (item.hasValue && current !== "" && !options.some((option) => option.value === current))
    options.push({ value: current, label: label(current) });
  const value = item.hasValue ? current : "";
  if (options.length <= maxSegments)
    return (
      <Segmented<string>
        size="sm"
        mono={!human}
        value={value}
        options={options}
        labelledBy={labelId}
        onChange={onSave}
      />
    );
  return (
    <Select<string>
      size="sm"
      mono={!human}
      value={value}
      options={options}
      placeholder={t("settings.cfg.unset")}
      labelledBy={labelId}
      onChange={(next) => next !== "" && onSave(next)}
    />
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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
      // omp 的 goal.continuationModes 在界面里是“目标自动推进”开关：只增减 "rpc"，别的条目保留。
      if (item.key === goalContinuationKey)
        return (
          <Switch
            checked={goalContinuationOn(item.value)}
            labelledBy={labelId}
            onChange={(on) => onSave(withGoalContinuation(item.value, on))}
          />
        );
      if (item.key === "modelRoles" && canEditStructured(item)) return <StructuredControl {...props} />;
      if (item.key === "retry.fallbackChains" && canEditStructured(item)) return <StructuredControl {...props} />;
      if (item.type === "array" && (!item.hasValue || isStringArray(item.value)))
        return (
          <TagInput
            values={isStringArray(item.value) ? item.value : []}
            labelledBy={labelId}
            onChange={onSave}
            testId={`cfg-tags-${item.key}`}
          />
        );
      return <JsonControl {...props} />;
  }
}
