// 自定义提供商对话框里的"模型"一栏：工具栏（全选方框、一键拉取、自动发现开关）、勾选、筛选、手动添加；勾选的模型在同一行设思考、
// 图片输入、上下文窗口、最大输出（models.yml 模型条目或 `modelOverrides` 覆盖项的 reasoning / input / contextWindow / maxTokens）。
// 状态（rows、提示）由对话框持有。覆盖内置 provider 的对话框不传 fetch / discovery，工具栏里就没有这两项。
import { useMemo, useState } from "react";
import { parseTokenCount, type CustomModelMeta } from "../../../../shared/custom-models.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Checkbox, Notice, NumberField, Switch, TextField } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";
import { formatCount } from "../composer/usage-format.ts";

export interface ModelRow {
  id: string;
  /** 只有一键拉取带来的新模型才有名字（Anthropic 的 display_name）；已有的不重写。 */
  name?: string;
  checked: boolean;
  /** null = 自动（不写进 models.yml，omp 自己补）。 */
  reasoning: boolean | null;
  images: boolean | null;
  /** 输入框里的原文（可以写 272k、1m）；保存时用 parseTokenCount 换成数。空 = 自动。 */
  contextWindow: string;
  maxTokens: string;
}

export interface FetchNotice {
  tone: "ok" | "error";
  text: string;
}

interface CustomModelListProps {
  rows: ModelRow[];
  onRows(update: (rows: ModelRow[]) => ModelRow[]): void;
  /** omp 现在给这个模型用的值（只有文件里没写、omp 已经加载过的项才有，其余为 null）：显示在"自动"后面。 */
  hintOf(id: string): CustomModelMeta;
  notice: FetchNotice | null;
  onNotice(notice: FetchNotice | null): void;
  /** 一键拉取。 */
  fetch?: { busy: boolean; disabled: boolean; run(): void };
  /** 自动发现模型（models.yml 里写 discovery）；接口类型没有通用发现方式时开关停用。 */
  discovery?: { on: boolean; supported: boolean; onChange(next: boolean): void };
}

type Flag = "auto" | "yes" | "no";

const flagOf = (value: boolean | null): Flag => (value === null ? "auto" : value ? "yes" : "no");

export function CustomModelList({ rows, onRows, hintOf, notice, onNotice, fetch, discovery }: CustomModelListProps) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const selectedCount = rows.filter((row) => row.checked).length;
  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === "" ? rows : rows.filter((row) => row.id.toLowerCase().includes(needle));
  }, [rows, filter]);

  const update = (id: string, patch: Partial<ModelRow>) =>
    onRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addManual = () => {
    const modelId = manual.trim();
    if (modelId === "") return;
    setManual("");
    if (rows.some((row) => row.id === modelId)) {
      update(modelId, { checked: true });
      onNotice({ tone: "ok", text: t("custom.form.models.duplicate") });
      return;
    }
    onNotice(null);
    onRows((current) => [
      ...current,
      { id: modelId, checked: true, reasoning: null, images: null, contextWindow: "", maxTokens: "" },
    ]);
  };

  const yes = t("custom.form.meta.yes");
  const no = t("custom.form.meta.no");
  const autoLabel = (hint: string | null) =>
    hint === null ? t("custom.form.meta.auto") : t("custom.form.meta.autoIs", { value: hint });
  const columns = {
    reasoning: t("custom.form.meta.reasoning"),
    images: t("custom.form.meta.images"),
    contextWindow: t("custom.form.meta.contextWindow"),
    maxTokens: t("custom.form.meta.maxTokens"),
  };

  const flagCell = (row: ModelRow, key: "reasoning" | "images", hint: boolean | null) => (
    <Select<Flag>
      size="sm"
      width="100%"
      value={flagOf(row[key])}
      options={[
        { value: "auto", label: autoLabel(hint === null ? null : hint ? yes : no) },
        { value: "yes", label: yes },
        { value: "no", label: no },
      ]}
      label={t("custom.form.meta.cell", { column: columns[key], model: row.id })}
      testId={`custom-model-${key}-${row.id}`}
      onChange={(next) => update(row.id, { [key]: next === "auto" ? null : next === "yes" })}
    />
  );

  const countCell = (row: ModelRow, key: "contextWindow" | "maxTokens", hint: number | null) => (
    <NumberField
      size="sm"
      width="100%"
      autoComplete="off"
      value={row[key]}
      invalid={parseTokenCount(row[key]) === undefined}
      placeholder={autoLabel(hint === null ? null : formatCount(hint))}
      aria-label={t("custom.form.meta.cell", { column: columns[key], model: row.id })}
      testId={`custom-model-${key}-${row.id}`}
      onChange={(next) => update(row.id, { [key]: next })}
    />
  );

  return (
    <div className="cp-models">
      <div className="cp-models-bar">
        <Checkbox
          checked={rows.length > 0 && selectedCount === rows.length}
          indeterminate={selectedCount > 0 && selectedCount < rows.length}
          disabled={rows.length === 0}
          onChange={(next) => onRows((cur) => cur.map((row) => ({ ...row, checked: next })))}
          testId="custom-select-all"
        >
          {t("custom.form.models.all")}
        </Checkbox>
        {fetch !== undefined && (
          <Button size="sm" loading={fetch.busy} disabled={fetch.disabled} onClick={fetch.run} testId="custom-fetch">
            {t("custom.form.models.fetch")}
          </Button>
        )}
        {/* 说明（停用时是原因）在悬停提示里，不另起一段（切接口类型时对话框大小不变）。 */}
        {discovery !== undefined && (
          <label
            className="ui-choice"
            title={discovery.supported ? t("custom.form.discovery.tip") : t("custom.form.discovery.unsupported")}
          >
            <Switch
              checked={discovery.on}
              disabled={!discovery.supported}
              label={t("custom.form.discovery")}
              onChange={discovery.onChange}
              testId="custom-discovery"
            />
            <span>{t("custom.form.discovery")}</span>
          </label>
        )}
        {/* 行多到要筛选时才显示计数：少的时候勾了几个一眼看得到。 */}
        {rows.length > 12 && (
          <>
            <TextField
              size="sm"
              width={200}
              autoComplete="off"
              value={filter}
              placeholder={t("custom.form.models.filter")}
              aria-label={t("custom.form.models.filter")}
              onChange={setFilter}
            />
            <span className="cp-count" data-testid="custom-selected-count">
              {t("custom.form.models.selected", { selected: selectedCount, total: rows.length })}
            </span>
          </>
        )}
      </div>
      {notice !== null && (
        <Notice tone={notice.tone === "error" ? "error" : "info"} testId="custom-fetch-notice">
          {notice.text}
        </Notice>
      )}
      {rows.length === 0 ? (
        <p className="cp-text">{t("custom.form.models.empty")}</p>
      ) : (
        <div className="cp-model-table" data-testid="custom-model-list">
          {/* 列名只给看的人；每个控件自己的 aria-label 带着列名和模型 id。 */}
          <div className="cp-model-head" aria-hidden="true">
            <span />
            <span>{columns.reasoning}</span>
            <span>{columns.images}</span>
            <span>{columns.contextWindow}</span>
            <span>{columns.maxTokens}</span>
          </div>
          {visibleRows.map((row) => {
            const hint = row.checked ? hintOf(row.id) : null;
            return (
              <div key={row.id} className="cp-model-row" data-checked={row.checked || undefined}>
                <Checkbox
                  checked={row.checked}
                  testId={`custom-model-${row.id}`}
                  onChange={(next) => update(row.id, { checked: next })}
                >
                  <span className="cp-model-id" title={row.id}>
                    {row.id}
                  </span>
                </Checkbox>
                {hint !== null && (
                  <>
                    {flagCell(row, "reasoning", hint.reasoning)}
                    {flagCell(row, "images", hint.images)}
                    {countCell(row, "contextWindow", hint.contextWindow)}
                    {countCell(row, "maxTokens", hint.maxTokens)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="cp-manual">
        <TextField
          mono
          width="100%"
          autoComplete="off"
          value={manual}
          placeholder={t("custom.form.models.add.placeholder")}
          aria-label={t("custom.form.models.add.placeholder")}
          testId="custom-manual-model"
          onChange={setManual}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              // 在表单里按 Enter 是"添加这个模型"，不是"保存提供商"。
              event.preventDefault();
              event.stopPropagation();
              addManual();
            }
          }}
        />
        <Button disabled={manual.trim() === ""} onClick={addManual} testId="custom-manual-add">
          {t("custom.form.models.add")}
        </Button>
      </div>
    </div>
  );
}
