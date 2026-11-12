// 管理列表一行末尾的删除 / 移除 / 卸载（提供商、自定义提供商、MCP、SSH、插件、市场共用）：
// 只有一个动作时直接放一个按钮（2026-10-24 仓库所有者：一个按钮不收进 ⋯）；两个以上收进 ⋯ 菜单，红字放最后。
// 单个按钮是垃圾桶图标（行上的动作都是图标，2026-11-12 仓库所有者定），平时安静，悬停才变红；后果由确认框说（2026-10-29 审计 SET-15）。
import { useState } from "react";
import { Dots, Trash } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { anchorBelow, Menu, type MenuAction, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";

export function RowMenu({
  label,
  items,
  disabled = false,
  testId,
}: {
  /** 读屏名和菜单名（"更多"一类）。 */
  label: string;
  items: readonly MenuEntry[];
  disabled?: boolean;
  /** ⋯ 按钮的 testId；只有一个动作时按钮用那一项自己的 testId。 */
  testId?: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const actions = items.filter((item): item is MenuAction => !("kind" in item));
  const only = actions.length === 1 ? actions[0] : undefined;
  if (only !== undefined)
    return (
      <IconButton
        label={only.label}
        tip={only.disabledReason ?? (only.note === undefined ? undefined : `${only.label} · ${only.note}`)}
        className={only.tone === "danger" ? "st-quiet-danger" : undefined}
        disabled={disabled || only.disabledReason !== undefined}
        onClick={only.onSelect}
        testId={only.testId}
      >
        <Trash />
      </IconButton>
    );
  return (
    <>
      <IconButton
        label={label}
        expanded={anchor !== null}
        disabled={disabled}
        testId={testId}
        onClick={(event) => setAnchor(anchor === null ? anchorBelow(event.currentTarget) : null)}
      >
        <Dots />
      </IconButton>
      {anchor !== null && <Menu anchor={anchor} items={items} label={label} onClose={() => setAnchor(null)} />}
    </>
  );
}
