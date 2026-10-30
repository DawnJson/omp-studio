// 管理列表一行末尾的删除 / 移除 / 卸载（提供商、自定义提供商、MCP、SSH、插件、市场共用）：
// 只有一个动作时直接放一个 sm 按钮（2026-10-24 仓库所有者：一个按钮不收进 ⋯）；两个以上收进 ⋯ 菜单，红字放最后。
// 卡片上最多一个可见的文字按钮（2026-10-29 仓库所有者定）：旁边已经有主动作按钮时传 menuOnly，只有一项也收进 ⋯。
// 单个删除按钮平时是安静的文字按钮，悬停才变红：一屏几张卡片不再各挂一个红框；后果由确认框说（2026-10-29 审计 SET-15）。
import { useState } from "react";
import { Dots } from "../../icons.tsx";
import { Button, IconButton } from "../../ui/controls.tsx";
import { anchorBelow, Menu, type MenuAction, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";

export function RowMenu({
  label,
  items,
  disabled = false,
  menuOnly = false,
  testId,
}: {
  /** 读屏名和菜单名（"更多"一类）。 */
  label: string;
  items: readonly MenuEntry[];
  disabled?: boolean;
  /** 旁边已经有一个可见的文字按钮：只有一项也放进 ⋯，不再并排第二个文字按钮。 */
  menuOnly?: boolean;
  /** ⋯ 按钮的 testId；只有一个动作时按钮用那一项自己的 testId。 */
  testId?: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const actions = items.filter((item): item is MenuAction => !("kind" in item));
  const only = !menuOnly && actions.length === 1 ? actions[0] : undefined;
  if (only !== undefined)
    return (
      <Button
        size="sm"
        variant="quiet"
        className={only.tone === "danger" ? "st-quiet-danger" : undefined}
        disabled={disabled || only.disabledReason !== undefined}
        title={only.disabledReason ?? only.note}
        onClick={only.onSelect}
        testId={only.testId}
      >
        {only.label}
      </Button>
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
