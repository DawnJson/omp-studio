// 斜杠菜单：浮在输入框上方，行高 32，最多同时显示 8 行，更多的在菜单内滚动（键盘选中行始终可见）。键盘由 Composer 处理（↑↓ 选，Tab/Enter 补全，Esc 关闭）；鼠标点选补全。
import { useEffect, useRef } from "react";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";

interface SlashMenuProps {
  id: string;
  commands: readonly AvailableSlashCommand[];
  active: number;
  onHover(index: number): void;
  onPick(command: AvailableSlashCommand): void;
}

export function SlashMenu({ id, commands, active, onHover, onPick }: SlashMenuProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div className="slash" role="listbox" id={id} ref={listRef} aria-label={t("slash.label")} data-testid="slash-menu">
      {commands.length === 0 && <p className="pop-note">{t("slash.empty")}</p>}
      {commands.map((command, index) => (
        <button
          key={command.name}
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === active}
          className="slash-row"
          data-active={index === active || undefined}
          // 点选不抢走输入框焦点。
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(command)}
        >
          <span className="slash-name">/{command.name}</span>
          {command.input?.hint && <span className="slash-hint">{command.input.hint}</span>}
          <span className="slash-desc">{command.description ?? ""}</span>
        </button>
      ))}
    </div>
  );
}
