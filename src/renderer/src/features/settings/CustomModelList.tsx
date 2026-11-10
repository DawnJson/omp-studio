// 自定义提供商对话框里的"模型"一栏：工具栏（拉取模型、自动发现开关、移除失效的）、筛选、手动添加；表里的就是保存时写进 models.yml 的，
// 每行末尾 × 移除（悬停 / 聚焦时显示）。每行选对话 / 生图，对话模型再设思考、图片输入、上下文窗口、最大输出（models.yml 模型条目
// 或 `modelOverrides` 覆盖项的 reasoning / input / contextWindow / maxTokens）。状态（rows、提示、拉取结果）由对话框持有。
// 开着自动发现时对话框不传 fetch：表里是 omp 发现的模型（discovered 行，能力参数写进 modelOverrides）加上文件里 models[] 的，
// 不能逐个移除（这次手动添加的除外），发现的行没有类型列。
// 覆盖内置 provider 的对话框传 checkable、不传 fetch / discovery / image：每行一个勾选框（勾上 = 写覆盖项），工具栏是全选方框，没有类型列。
import { useMemo, useState } from "react";
import {
  parseTokenCount,
  vanishedModelIds,
  type CustomModelMeta,
  type FetchedModel,
} from "../../../../shared/custom-models.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Badge, Button, Checkbox, IconButton, Notice, NumberField, Switch, TextField } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";
import { formatCount } from "../composer/usage-format.ts";
import { ModelPicker } from "./ModelPicker.tsx";

export interface ModelRow {
  id: string;
  /** 只有一键拉取带来的新模型才有名字（Anthropic 的 display_name）；已有的不重写。 */
  name?: string;
  /** 只有覆盖内置 provider 的对话框用（checkable）：这个模型写不写覆盖项。自定义 provider 的行都要保存，不用它。 */
  checked?: boolean;
  /** null = 自动（不写进 models.yml，omp 自己补）。 */
  reasoning: boolean | null;
  images: boolean | null;
  /** 输入框里的原文（可以写 272k、1m）；保存时用 parseTokenCount 换成数。空 = 自动。 */
  contextWindow: string;
  maxTokens: string;
  /** 生图模型（models.yml 里 `api: openai-images` / `kind: image`）：没有对话的四项参数。undefined = 新加的、类型还没定。 */
  image?: boolean;
  /** 这次在对话框里手动添加的：不标"已失效"（手动加的多半是服务不列出的隐藏模型）；开着自动发现时也能 × 掉。 */
  manual?: boolean;
  /** omp 自动发现的模型（不在 models[] 里）：能力参数写进 `modelOverrides.<id>`，不能移除，没有类型（生图）列。 */
  discovered?: boolean;
}

/** 改成生图时清掉对话的四项：生图模型用不上，留着会照样写进 models.yml。 */
export const imageRowPatch = {
  image: true,
  reasoning: null,
  images: null,
  contextWindow: "",
  maxTokens: "",
} satisfies Partial<ModelRow>;

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
  /** 覆盖内置 provider：每行一个勾选框（勾上 = 写覆盖项）、工具栏有全选；不给时每行末尾 × 移除。 */
  checkable?: boolean;
  /** 一键拉取：成功后弹出选择浮层，选中的追加到列表；列表里拉到的列表没有的标"已失效"。 */
  fetch?: {
    busy: boolean;
    disabled: boolean;
    run(): void;
    /** 最近一次成功拉取到的模型；还没拉取、或最近一次失败时 null（什么都不标）。 */
    fetched: readonly FetchedModel[] | null;
    picking: boolean;
    onPickClose(): void;
    onAdd(models: FetchedModel[]): void;
  };
  /** 自动发现模型（models.yml 里写 discovery）；接口类型没有通用发现方式时开关停用。开着时行不能移除（这次手动添加的除外）。 */
  discovery?: {
    on: boolean;
    supported: boolean;
    onChange(next: boolean): void;
  };
  /** 类型列（对话 / 生图）；接口类型不能生图时只能改回对话。 */
  image?: { supported: boolean };
}

type Flag = "auto" | "yes" | "no";

const flagOf = (value: boolean | null): Flag => (value === null ? "auto" : value ? "yes" : "no");

type Kind = "chat" | "image";

const noIds: ReadonlySet<string> = new Set();

export function CustomModelList({
  rows,
  onRows,
  hintOf,
  notice,
  onNotice,
  checkable = false,
  fetch,
  discovery,
  image,
}: CustomModelListProps) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const selectedCount = rows.filter((row) => row.checked === true).length;
  const ids = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const fetched = fetch?.fetched ?? null;
  const vanished = useMemo(
    () =>
      fetched === null
        ? noIds
        : new Set(
            vanishedModelIds(
              rows.filter((row) => row.manual !== true).map((row) => row.id),
              fetched,
            ),
          ),
    [rows, fetched],
  );
  const needle = filter.trim().toLowerCase();
  const visibleRows = needle === "" ? rows : rows.filter((row) => row.id.toLowerCase().includes(needle));
  // 开着自动发现时表里跟着 omp 发现的列表走，不能逐个移除；这次手动添加、还没保存的照样能 ×（撤销）。
  const removable = (row: ModelRow) => !checkable && (discovery?.on !== true || row.manual === true);

  const update = (id: string, patch: Partial<ModelRow>) =>
    onRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (gone: ReadonlySet<string>) => onRows((current) => current.filter((row) => !gone.has(row.id)));

  const addManual = () => {
    const modelId = manual.trim();
    if (modelId === "") return;
    setManual("");
    if (ids.has(modelId)) {
      if (checkable) update(modelId, { checked: true });
      onNotice({ tone: "ok", text: t("custom.form.models.duplicate") });
      return;
    }
    onNotice(null);
    onRows((current) => [
      ...current,
      {
        id: modelId,
        manual: true,
        ...(checkable && { checked: true }),
        reasoning: null,
        images: null,
        contextWindow: "",
        maxTokens: "",
      },
    ]);
  };

  const yes = t("custom.form.meta.yes");
  const no = t("custom.form.meta.no");
  const autoLabel = (hint: string | null) =>
    hint === null ? t("custom.form.meta.auto") : t("custom.form.meta.autoIs", { value: hint });
  const columns = {
    kind: t("custom.form.meta.kind"),
    reasoning: t("custom.form.meta.reasoning"),
    images: t("custom.form.meta.images"),
    contextWindow: t("custom.form.meta.contextWindow"),
    maxTokens: t("custom.form.meta.maxTokens"),
  };

  const kindCell = (row: ModelRow, supported: boolean) => (
    <div title={supported || row.image === true ? undefined : t("custom.form.meta.kind.unsupported")}>
      <Select<Kind>
        size="sm"
        width="100%"
        value={row.image === true ? "image" : "chat"}
        options={[
          { value: "chat", label: t("custom.form.meta.kind.chat") },
          { value: "image", label: t("custom.form.meta.kind.image") },
        ]}
        disabled={!supported && row.image !== true}
        label={t("custom.form.meta.cell", { column: columns.kind, model: row.id })}
        testId={`custom-model-kind-${row.id}`}
        onChange={(next) => update(row.id, next === "image" ? imageRowPatch : { image: false })}
      />
    </div>
  );

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

  const nameCell = (row: ModelRow) => {
    const idText = (
      <span className="cp-model-id" title={row.id}>
        {row.id}
      </span>
    );
    return checkable ? (
      <Checkbox
        checked={row.checked === true}
        testId={`custom-model-${row.id}`}
        onChange={(next) => update(row.id, { checked: next })}
      >
        {idText}
      </Checkbox>
    ) : (
      <span className="cp-model-name">
        {idText}
        {vanished.has(row.id) && (
          <Badge tone="warning" title={t("custom.form.models.vanished.tip")} testId={`custom-model-vanished-${row.id}`}>
            {t("custom.form.models.vanished")}
          </Badge>
        )}
      </span>
    );
  };

  return (
    <div className="cp-models">
      <div className="cp-models-bar">
        {checkable && (
          <Checkbox
            checked={rows.length > 0 && selectedCount === rows.length}
            indeterminate={selectedCount > 0 && selectedCount < rows.length}
            disabled={rows.length === 0}
            onChange={(next) => onRows((cur) => cur.map((row) => ({ ...row, checked: next })))}
            testId="custom-select-all"
          >
            {t("custom.form.models.all")}
          </Checkbox>
        )}
        {fetch !== undefined && (
          <span className="ui-popover-anchor cp-fetch">
            <Button size="sm" loading={fetch.busy} disabled={fetch.disabled} onClick={fetch.run} testId="custom-fetch">
              {t("custom.form.models.fetch")}
            </Button>
            <ModelPicker
              open={fetch.picking}
              onClose={fetch.onPickClose}
              models={fetch.fetched ?? []}
              added={ids}
              onAdd={fetch.onAdd}
            />
          </span>
        )}
        {/* 说明和停用原因都在悬停提示里，不另起一段（切接口类型时对话框大小不变）。 */}
        {discovery !== undefined && (
          <label
            className="ui-choice"
            title={discovery.supported ? t("custom.form.discovery.tip") : t("custom.form.discovery.unsupported")}
            data-testid="custom-discovery-label"
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
        {vanished.size > 0 && (
          <Button size="sm" onClick={() => remove(vanished)} testId="custom-remove-vanished">
            {t("custom.form.models.removeVanished", { count: vanished.size })}
          </Button>
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
            {checkable && (
              <span className="cp-count" data-testid="custom-selected-count">
                {t("custom.form.models.selected", { selected: selectedCount, total: rows.length })}
              </span>
            )}
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
        <div
          className="cp-model-table"
          data-kinds={image !== undefined || undefined}
          data-remove={!checkable || undefined}
          data-testid="custom-model-list"
        >
          {/* 列名只给看的人；每个控件自己的 aria-label 带着列名和模型 id。 */}
          <div className="cp-model-head" aria-hidden="true">
            <span />
            {image !== undefined && <span>{columns.kind}</span>}
            <span>{columns.reasoning}</span>
            <span>{columns.images}</span>
            <span>{columns.contextWindow}</span>
            <span>{columns.maxTokens}</span>
            {!checkable && <span />}
          </div>
          {visibleRows.map((row) => {
            const hint = !checkable || row.checked === true ? hintOf(row.id) : null;
            return (
              <div
                key={row.id}
                className="cp-model-row"
                data-checked={row.checked === true || undefined}
                data-testid={checkable ? undefined : `custom-model-${row.id}`}
              >
                {nameCell(row)}
                {/* 发现的行写不了生图（那要写进 models[]）：类型格空着占位。 */}
                {hint !== null &&
                  image !== undefined &&
                  (row.discovered === true ? <span /> : kindCell(row, image.supported))}
                {hint !== null && row.image !== true && (
                  <>
                    {flagCell(row, "reasoning", hint.reasoning)}
                    {flagCell(row, "images", hint.images)}
                    {countCell(row, "contextWindow", hint.contextWindow)}
                    {countCell(row, "maxTokens", hint.maxTokens)}
                  </>
                )}
                {removable(row) && (
                  <IconButton
                    className="cp-model-remove"
                    label={t("custom.form.models.remove", { model: row.id })}
                    tip={t("custom.form.models.removeTip")}
                    testId={`custom-model-remove-${row.id}`}
                    onClick={() => remove(new Set([row.id]))}
                  >
                    <Close />
                  </IconButton>
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
