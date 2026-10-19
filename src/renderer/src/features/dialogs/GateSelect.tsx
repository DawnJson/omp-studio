// select（含工具审批）：选项 ≤3 且没有描述 → 一排按钮；否则选项列表。Enter 永不隐式允许：没有预选项。
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import { approvalOptionLabel, splitTitle, stripCommandPrefix } from "./approval-labels.ts";
import type { DialogRequest } from "../../../../shared/ipc.ts";
import type { GateBodyProps } from "./Gate.tsx";

const COLLAPSE_LINES = 8;
const FILTER_OVER = 7;

function Details({ text }: { text: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > COLLAPSE_LINES;
  return (
    <div className="gate-details">
      <pre className="gate-pre" data-collapsed={(long && !expanded) || undefined}>
        {long && !expanded ? lines.slice(0, COLLAPSE_LINES).join("\n") : text}
      </pre>
      {long && !expanded && (
        <button type="button" className="gate-link" onClick={() => setExpanded(true)}>
          {t("gate.detailsExpand")}
        </button>
      )}
    </div>
  );
}

export { Details as GateDetails };

export function GateSelect({
  dialog,
  busy,
  respond,
  primaryRef,
  preview = null,
}: GateBodyProps<Extract<DialogRequest, { kind: "select" }>>) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const approval = dialog.approval;
  const options = dialog.options;
  const body = approval ? stripCommandPrefix(splitTitle(dialog.title).details) : "";
  const row = options.length <= 3 && options.every((option) => !option.description);
  const visible = useMemo(
    () =>
      options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => filter === "" || option.label.toLowerCase().includes(filter.toLowerCase())),
    [options, filter],
  );
  const label = (text: string) => (approval ? approvalOptionLabel(text, t) : text);
  const choose = (index: number) => {
    const option = options[index];
    if (option && !busy) respond({ kind: "value", value: option.label });
  };

  useEffect(() => {
    primaryRef.current = () => choose(0);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 数字键只在门本体聚焦、且没有文本输入时生效。
    if (event.target !== event.currentTarget || options.length > 9 || event.ctrlKey || event.altKey || event.metaKey)
      return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      event.preventDefault();
      choose(digit - 1);
    }
  };

  return (
    <div className="gate-body" onKeyDown={onKeyDown}>
      {body !== "" && <Details text={body} />}
      {preview !== null && <Details text={preview} />}
      {row ? (
        <div className="gate-actions">
          {options.map((option, index) => (
            <button
              key={option.label}
              type="button"
              className="gate-btn"
              data-primary={index === 0 || undefined}
              data-deny={(approval && index === options.length - 1) || undefined}
              disabled={busy}
              title={options.length <= 9 ? `${label(option.label)} (${index + 1})` : undefined}
              onClick={() => choose(index)}
            >
              <span className="gate-btn-label">{label(option.label)}</span>
              {index === 0 && <kbd className="gate-key">Ctrl+Enter</kbd>}
              {approval && index === options.length - 1 && <kbd className="gate-key">Esc</kbd>}
            </button>
          ))}
        </div>
      ) : (
        <>
          {options.length > FILTER_OVER && (
            <input
              className="gate-input"
              value={filter}
              placeholder={t("gate.filter")}
              onChange={(event) => setFilter(event.target.value)}
              aria-label={t("gate.filter")}
            />
          )}
          <div className="gate-list" role="listbox">
            {visible.map(({ option, index }) => (
              <button
                key={option.label}
                type="button"
                role="option"
                aria-selected={false}
                className="gate-row"
                title={index < 9 ? `${label(option.label)} (${index + 1})` : undefined}
                disabled={busy}
                onClick={() => choose(index)}
              >
                <span className="gate-row-text" title={option.description}>
                  <span className="gate-row-label">{label(option.label)}</span>
                  {option.description && <span className="gate-row-desc">{option.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
