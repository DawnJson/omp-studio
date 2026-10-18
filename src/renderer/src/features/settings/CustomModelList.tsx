// 自定义提供商表单里的"模型"一栏：一键拉取、勾选、筛选、手动添加。状态（rows、提示）由表单持有。
import { useMemo, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "./controls.tsx";

export interface ModelRow {
  id: string;
  /** 只有一键拉取带来的新模型才有名字（Anthropic 的 display_name）；已有的不重写。 */
  name?: string;
  checked: boolean;
}

export interface FetchNotice {
  tone: "ok" | "error";
  text: string;
}

interface CustomModelListProps {
  rows: ModelRow[];
  onRows(update: (rows: ModelRow[]) => ModelRow[]): void;
  notice: FetchNotice | null;
  onNotice(notice: FetchNotice | null): void;
  fetching: boolean;
  fetchDisabled: boolean;
  onFetch(): void;
}

export function CustomModelList({
  rows,
  onRows,
  notice,
  onNotice,
  fetching,
  fetchDisabled,
  onFetch,
}: CustomModelListProps) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const selectedCount = rows.filter((row) => row.checked).length;
  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === "" ? rows : rows.filter((row) => row.id.toLowerCase().includes(needle));
  }, [rows, filter]);

  const addManual = () => {
    const modelId = manual.trim();
    if (modelId === "") return;
    setManual("");
    if (rows.some((row) => row.id === modelId)) {
      onRows((current) => current.map((row) => (row.id === modelId ? { ...row, checked: true } : row)));
      onNotice({ tone: "ok", text: t("custom.form.models.duplicate") });
      return;
    }
    onNotice(null);
    onRows((current) => [...current, { id: modelId, checked: true }]);
  };

  return (
    <div className="cp-control cp-models">
      <div className="cp-models-bar">
        <Button loading={fetching} disabled={fetchDisabled} onClick={onFetch} testId="custom-fetch">
          {t("custom.form.models.fetch")}
        </Button>
        {rows.length > 0 && (
          <>
            <Button variant="text" onClick={() => onRows((cur) => cur.map((row) => ({ ...row, checked: true })))}>
              {t("custom.form.models.all")}
            </Button>
            <Button variant="text" onClick={() => onRows((cur) => cur.map((row) => ({ ...row, checked: false })))}>
              {t("custom.form.models.none")}
            </Button>
            <span className="st-muted cp-count" data-testid="custom-selected-count">
              {t("custom.form.models.selected", { selected: selectedCount, total: rows.length })}
            </span>
          </>
        )}
      </div>
      {notice !== null && (
        <div
          className={notice.tone === "error" ? "st-error-text" : "st-muted"}
          role={notice.tone === "error" ? "alert" : "status"}
          data-testid="custom-fetch-notice"
        >
          {notice.text}
        </div>
      )}
      {rows.length > 12 && (
        <input
          className="st-input"
          autoComplete="off"
          spellCheck={false}
          value={filter}
          placeholder={t("custom.form.models.filter")}
          aria-label={t("custom.form.models.filter")}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      {rows.length === 0 ? (
        <div className="st-muted">{t("custom.form.models.empty")}</div>
      ) : (
        <div className="cp-model-list" data-testid="custom-model-list">
          {visibleRows.map((row) => (
            <label key={row.id} className="cp-model">
              <input
                type="checkbox"
                checked={row.checked}
                data-testid={`custom-model-${row.id}`}
                onChange={(event) =>
                  onRows((current) =>
                    current.map((candidate) =>
                      candidate.id === row.id ? { ...candidate, checked: event.target.checked } : candidate,
                    ),
                  )
                }
              />
              <span className="st-mono st-ellipsis" title={row.id}>
                {row.id}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="cp-manual">
        <input
          className="st-input"
          data-mono
          autoComplete="off"
          spellCheck={false}
          value={manual}
          placeholder={t("custom.form.models.add.placeholder")}
          aria-label={t("custom.form.models.add.placeholder")}
          data-testid="custom-manual-model"
          onChange={(event) => setManual(event.target.value)}
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
