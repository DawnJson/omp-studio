// 输入框的右键菜单（输入框、搜索框、设置里的文本框……）：撤销 / 剪切 / 复制 / 粘贴 / 全选，样式同 ui/Menu。
// 命令交给主进程对获得焦点的输入框执行（editField）：渲染进程不读剪贴板，粘贴照常发 paste 事件，输入框的附件处理不变。
// 自己画右键菜单的地方（任务行、过程区等）先 preventDefault，这里就不弹。
import { useCallback, useEffect, useState } from "react";
import type { EditCommand } from "../../../shared/ipc.ts";
import { useT } from "../i18n/use-t.ts";
import { reportError } from "../ui/errors.ts";
import { Menu, type MenuAnchor, type MenuEntry } from "../ui/Menu.tsx";

type Field = HTMLInputElement | HTMLTextAreaElement;

const textInputs = new Set(["text", "search", "url", "email", "tel", "number", "password"]);

function editableField(target: EventTarget | null): Field | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest("textarea, input");
  if (field instanceof HTMLTextAreaElement) return field;
  if (field instanceof HTMLInputElement && textInputs.has(field.type)) return field;
  return null;
}

export function EditMenu() {
  const t = useT();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuEntry[] } | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const field = editableField(event.target);
      if (field === null || field.disabled) return;
      event.preventDefault();
      field.focus();
      // number 框没有选区（selectionStart 为 null），当作没选中。
      const selected = field.selectionStart !== null && field.selectionStart !== field.selectionEnd;
      const writable = !field.readOnly;
      const secret = field instanceof HTMLInputElement && field.type === "password";
      const run = (command: EditCommand) => () => {
        field.focus();
        window.studio.editField(command).catch((error: unknown) => reportError(t, error));
      };
      const item = (command: EditCommand, label: string, shortcut: string): MenuEntry => ({
        id: command,
        label,
        shortcut,
        testId: `edit-menu-${command}`,
        onSelect: run(command),
      });
      const items: MenuEntry[] = [
        ...(writable ? [item("undo", t("menu.undo"), "Ctrl Z"), { kind: "separator" as const, id: "s1" }] : []),
        ...(writable && selected && !secret ? [item("cut", t("menu.cut"), "Ctrl X")] : []),
        ...(selected && !secret ? [item("copy", t("menu.copy"), "Ctrl C")] : []),
        ...(writable ? [item("paste", t("menu.paste"), "Ctrl V")] : []),
        item("selectAll", t("menu.selectAll"), "Ctrl A"),
      ];
      setMenu({ anchor: { x: event.clientX, y: event.clientY, returnFocus: field }, items });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, [t]);

  if (menu === null) return null;
  return <Menu anchor={menu.anchor} items={menu.items} label={t("menu.edit")} onClose={close} testId="edit-menu" />;
}
