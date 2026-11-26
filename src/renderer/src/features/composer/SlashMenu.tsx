// 斜杠菜单：浮在输入框上方，行高 32，最多同时显示 8 行，更多的在菜单内滚动（键盘选中行始终可见）；上方放不下 8 行（窗口矮）时缩到主区顶边为止（useFitInside）。
// 键盘由 Composer 处理（↑↓ 选，Tab/Enter 补全，Esc 关闭）；鼠标点选补全。
// studio 接管的命令行尾带 ↗：发出去由 studio 处理（多半开 studio 自己的界面），和 omp 原生命令区分开。
import { useEffect, useMemo, useRef } from "react";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { External } from "../../icons.tsx";
import { useFitInside } from "../../ui/Popover.tsx";
import { usePresence } from "../../ui/presence.ts";
import { handledCommands, type SlashHost } from "./studio-slash.ts";
import { studioSlashCommands } from "./studio-slash-table.ts";

interface SlashMenuProps {
  id: string;
  open: boolean;
  /** 任务输入框或草稿页：两处 studio 接管的命令不同（studio-slash.ts）。 */
  host: SlashHost;
  commands: readonly AvailableSlashCommand[];
  active: number;
  onHover(index: number): void;
  onPick(command: AvailableSlashCommand): void;
}

export function SlashMenu({ id, open, host, commands: liveCommands, active, onHover, onPick }: SlashMenuProps) {
  const t = useT();
  const studioNames = useMemo(
    () => new Set(handledCommands(studioSlashCommands, host).map((command) => command.name)),
    [host],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  // 关闭放退出动画时 Composer 传来的是空列表，沿用关闭前的内容。
  const heldRef = useRef(liveCommands);
  if (open) heldRef.current = liveCommands;
  const commands = open ? liveCommands : heldRef.current;
  useEffect(() => {
    listRef.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  useFitInside(listRef, open);
  if (!presence.mounted) return null;
  return (
    <div
      className="slash"
      role="listbox"
      id={id}
      ref={listRef}
      aria-label={t("slash.label")}
      data-testid="slash-menu"
      {...presence.exitProps}
    >
      {commands.length === 0 && <p className="slash-empty">{t("slash.empty")}</p>}
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
          {studioNames.has(command.name) && (
            <span className="slash-studio" data-testid="slash-studio" title={t("slash.studioHandled")}>
              <External size={14} aria-label={t("slash.studioHandled")} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
