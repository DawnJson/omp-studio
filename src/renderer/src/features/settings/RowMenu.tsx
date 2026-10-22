// 管理列表一行末尾的 ⋯ 菜单（提供商、自定义提供商、MCP、SSH、插件、市场共用）：删除 / 移除 / 卸载收在这里，红字放最后。
import { useState } from "react";
import { Dots } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { anchorBelow, Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";

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
  testId?: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
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
