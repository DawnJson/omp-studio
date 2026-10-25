// 草稿页（还没有任务）输入框的斜杠菜单和 studio 命令：列表是服务进程的命令加上草稿页能用的 studio 命令（宿主 "draft"）。
// 菜单的键盘规则和任务输入框（Composer.tsx）一致：↑↓ 选，Tab 补全，Enter 只在候选是前缀匹配且还没输完整命令名时补全，Esc 收起。
import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useDraftSlashCommands } from "../palette/slash-commands.ts";
import { primaryMod } from "../../app/platform-keys.ts";
import { matchSlash, slashQuery } from "./slash-match.ts";
import { findStudioSlash, handledCommands, withStudioSlash } from "./studio-slash.ts";
import { studioSlashCommands } from "./studio-slash-table.ts";

/** 草稿开头是草稿页能处理的 studio 命令时，返回要执行的动作；否则 null（照常当第一条消息发出）。 */
export function draftSlashRunner(text: string, t: TFunction): (() => Promise<void> | void) | null {
  const hit = findStudioSlash(text, handledCommands(studioSlashCommands, "draft"));
  if (hit === null) return null;
  const { command, args } = hit;
  return () => command.draft?.(args, t);
}

export interface DraftSlashMenu {
  open: boolean;
  matches: AvailableSlashCommand[];
  active: number;
  setActive(index: number): void;
  pick(command: AvailableSlashCommand): void;
  /** 菜单开着时处理按键；返回 true = 已处理。 */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
  /** 文字变了：高亮回到第一项。 */
  reset(): void;
}

export function useDraftSlashMenu(
  text: string,
  setText: (text: string) => void,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  t: TFunction,
): DraftSlashMenu {
  const omp = useDraftSlashCommands();
  const commands = useMemo(
    () => (omp.length === 0 ? omp : withStudioSlash(omp, studioSlashCommands, t, "draft")),
    [omp, t],
  );
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const query = slashQuery(text);
  const open = query !== null && closedFor !== text && commands.length > 0;
  const matches = open && query !== null ? matchSlash(commands, query) : [];
  const active = Math.min(index, Math.max(matches.length - 1, 0));

  const pick = (command: AvailableSlashCommand) => {
    setText(`/${command.name} `);
    setIndex(0);
    fieldRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    const picked = matches[active];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = Math.max(matches.length, 1);
      setIndex((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setClosedFor(text);
      return true;
    }
    const prefixHit =
      picked !== undefined &&
      query !== null &&
      [picked.name, ...(picked.aliases ?? [])].some((name) => name.toLowerCase().startsWith(query.toLowerCase()));
    if (
      picked &&
      (event.key === "Tab" ||
        (event.key === "Enter" && !event.shiftKey && !primaryMod(event) && prefixHit && text !== `/${picked.name}`))
    ) {
      event.preventDefault();
      pick(picked);
      return true;
    }
    return false;
  };

  return { open, matches, active, setActive: setIndex, pick, onKeyDown, reset: () => setIndex(0) };
}
