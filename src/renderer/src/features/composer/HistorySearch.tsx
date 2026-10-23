// Ctrl+R 输入历史搜索（spec 4.14）：浮在输入框上方，上面一个搜索框，下面是匹配的历史消息（最新的在前，最多同时显示 8 行，更多的滚动）。
// 键盘：↑↓ 选、Enter 填进输入框、Esc 关闭（不触发"停止任务"）；点一行也是填入。焦点在搜索框里；关闭后还给输入框。
// 条目来自 input-history.ts 合并出的历史；studio 自己持久化，不读 omp 的 history.db（omp 自己的 Ctrl+R 在 tsp-view 里仍然转发给 omp）。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchHistory } from "../../../../shared/input-history.ts";
import { useT } from "../../i18n/use-t.ts";
import { Search } from "../../icons.tsx";
import { usePresence } from "../../ui/presence.ts";
import { TextField } from "../../ui/controls.tsx";

interface HistorySearchProps {
  open: boolean;
  /** 从旧到新。 */
  entries: readonly string[];
  onPick(text: string): void;
  onClose(): void;
}

/** 多行消息在列表里只显示第一行，后面跟 ↵。 */
function oneLine(text: string): string {
  const [first = "", ...rest] = text.split(/\r?\n/);
  return rest.length > 0 ? `${first} ↵` : first;
}

export function HistorySearch({ open, entries, onPick, onClose }: HistorySearchProps) {
  const t = useT();
  const presence = usePresence(open);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchHistory(entries, query);
  const current = Math.min(active, Math.max(results.length - 1, 0));

  // 每次打开：清空查询、选中最新一条、聚焦搜索框（退出动画期间重新打开也要重来，所以依赖 open）。
  // 用 layout effect：在这次提交里同步清空，打开后马上敲进来的字不会被晚到的清空吃掉。
  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[id="history-row-${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!presence.mounted) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = Math.max(results.length, 1);
      setActive((current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = results[current];
      if (picked !== undefined) onPick(picked);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="slash history"
      role="dialog"
      aria-label={t("composer.history.label")}
      data-testid="history-search"
      {...presence.exitProps}
    >
      <TextField
        size="sm"
        value={query}
        onChange={(value) => {
          setQuery(value);
          setActive(0);
        }}
        ref={inputRef}
        leading={<Search size={14} />}
        placeholder={t("composer.history.placeholder")}
        aria-label={t("composer.history.placeholder")}
        role="combobox"
        aria-expanded="true"
        aria-controls="history-list"
        aria-activedescendant={results.length > 0 ? `history-row-${current}` : undefined}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // 点到浮层外面：关闭（点列表行不算，行的 mousedown 会阻止失焦）。
          if (!event.currentTarget.closest(".history")?.contains(event.relatedTarget as Node | null)) onClose();
        }}
        testId="history-query"
      />
      <div ref={listRef} id="history-list" role="listbox" aria-label={t("composer.history.label")}>
        {results.length === 0 && <p className="slash-empty">{t("composer.history.empty")}</p>}
        {results.map((text, index) => (
          <button
            key={text}
            id={`history-row-${index}`}
            type="button"
            role="option"
            aria-selected={index === current}
            className="slash-row"
            data-active={index === current || undefined}
            title={text}
            data-testid="history-row"
            // 点选不抢走搜索框焦点（否则 blur 先关掉浮层，click 就丢了）。
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(text)}
          >
            <span className="history-text">{oneLine(text)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
