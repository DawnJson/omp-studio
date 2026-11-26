// `menu` 和 `buttons` 节点（规范 TspMenuProps / TspButtonsProps；omp 19 的计划审阅底栏 Approve ▾、执行模型下拉、/jobs 的输出来源）。
// - menu：触发器是 ui 按钮（text / icon / caret / trigger / size / disabled，原因当悬停提示；没有 text 和 icon 是方形 …）。
//   下拉是公共的 ui Menu（spec §4.23）：分隔线、小节标题、图标、快捷键、第二行 detail、勾选 / 单选、不可用（原因写第二行）、danger 红字；
//   子菜单在桌面上就地展开成一个小节（menu-model.ts）。选一行发 `{ev:"action", id:<menu 节点>, act:<行 id>, checked?}`；
//   打开 / 关上发 `{ev:"toggle", id, open}`；omp 给的 `open` 一变就照它开关（规范：变化胜过本地开关），`active` 那一行高亮。
//   触发器不抢焦点（规范 pointer-only）；打开后焦点在菜单里（Esc、方向键照 ui Menu），关上回到打开前的地方。
// - buttons：子节点并成一个控件。joined / split 共用边框、只留外侧圆角，split 的最后一个子节点（menu）就是菜单那半边；
//   toolbar 是浅底槽。`size` 盖过子节点自己的；`label` 是组的读屏名。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n/use-t.ts";
import { Button as UiButton, type ButtonVariant } from "../../../ui/controls.tsx";
import { anchorBelow, anchorBelowEnd, Menu as UiMenu, type MenuAnchor, type MenuEntry } from "../../../ui/Menu.tsx";
import { gateKeyHint } from "../fmt.ts";
import { TspIcon } from "../icons.tsx";
import { Button } from "../interactive/Button.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps, TspContext } from "../node-props.ts";
import { useTspNode } from "../tsp-store.ts";
import { TspNode } from "../TspChildren.tsx";
import { chosenAction, menuModel } from "./menu-model.ts";
import "./menu.css";

/** 所在 `buttons` 组给子节点的：统一尺寸。 */
const GroupSize = createContext<"sm" | "md" | undefined>(undefined);

const TRIGGERS: Record<string, ButtonVariant> = { primary: "primary", quiet: "quiet" };
const MENU_TEST_ID = "tsp-node-menu";

export function Menu(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const t = useT();
  const groupSize = useContext(GroupSize);
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const entries = useMemo(() => menuModel(p.items), [p.items]);
  const reason = typeof p.disabled === "string" && p.disabled !== "" ? p.disabled : null;
  // 按下触发器时菜单开着没有：ui Menu 在按下（捕获阶段）就开始关，到 click 时状态可能已经清掉，所以在按下时记。
  const openAtPress = useRef(false);
  const disabled = p.disabled === true || reason !== null;
  const end = p.align === "end";

  // 焦点留给关上后回去的地方（打开前的元素，一般是输入框）：触发器不拿焦点。
  const place = useCallback((): MenuAnchor | null => {
    const button = trigger.current;
    if (button === null) return null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return { ...(end ? anchorBelowEnd(button) : anchorBelow(button)), returnFocus: active };
  }, [end]);

  // omp 给的 open 变了就照它（规范）：这里不发 toggle，那是 omp 自己的决定。
  const open = p.open;
  useEffect(() => {
    if (open === true) setAnchor((now) => now ?? place());
    else if (open === false) setAnchor(null);
  }, [open, place]);

  // 关上（Esc、点外面、选了一行）：ui Menu 放完退出动画才调这里。
  const { sf } = ctx;
  const send = ctx.send;
  const onClose = useCallback(() => {
    setAnchor(null);
    send({ ev: "toggle", sf, id: node.id, open: false });
  }, [send, sf, node.id]);

  // omp 的键盘光标（active）：那一行画悬停底色并拿焦点。ui Menu 在它的 effect 里先聚焦第一行，子组件的 effect 先跑，所以这里在后。
  const rowIds = entries.flatMap((entry) => (entry.kind === "row" ? [entry.id] : []));
  const activeIndex = typeof p.active === "string" ? rowIds.indexOf(p.active) : -1;
  useEffect(() => {
    if (anchor === null) return;
    const menus = document.querySelectorAll(`[data-testid="${MENU_TEST_ID}"]`);
    const rows = menus[menus.length - 1]?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [];
    rows.forEach((row, index) => row.toggleAttribute("data-active", index === activeIndex));
    if (activeIndex >= 0) rows[activeIndex]?.focus();
  }, [anchor, activeIndex]);

  const items = entries.map((entry, index): MenuEntry => {
    const id = String(index);
    if (entry.kind === "separator") return { kind: "separator", id };
    if (entry.kind === "header") return { kind: "label", id, label: entry.label };
    return {
      id,
      label: entry.label,
      icon: entry.icon === undefined ? undefined : <TspIcon name={entry.icon} size={16} />,
      note: entry.detail,
      shortcut: entry.keys === undefined ? undefined : gateKeyHint(entry.keys),
      checked: entry.checked,
      disabledReason: typeof entry.disabled === "string" ? entry.disabled : undefined,
      disabled: entry.disabled === true,
      tone: entry.danger === true ? "danger" : undefined,
      onSelect: () => send({ ev: "action", sf, id: node.id, ...chosenAction(entry) }),
    };
  });

  const dom = nodeDomProps(props, "tsp-menu-trigger", { pointer: false });
  const text = typeof p.text === "string" ? p.text : "";
  const icon = typeof p.icon === "string" ? p.icon : text === "" ? "more" : undefined;
  const size = groupSize ?? (p.size === "sm" ? "sm" : "md");
  const label = dom["aria-label"] ?? (typeof p.title === "string" ? p.title : undefined);
  return (
    <>
      <UiButton
        ref={trigger}
        className={dom.className}
        style={dom.style}
        size={size}
        variant={TRIGGERS[String(p.trigger)] ?? "secondary"}
        data-id={dom["data-id"]}
        data-role={dom["data-role"]}
        data-icon-only={text === "" ? "" : undefined}
        title={reason ?? dom.title}
        aria-label={text === "" ? (label ?? t("tsp.nodeMenu")) : label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-disabled={disabled || undefined}
        icon={icon === undefined ? undefined : <TspIcon name={icon} size={14} />}
        onPointerDown={() => {
          openAtPress.current = anchor !== null;
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          const wasOpen = openAtPress.current || anchor !== null;
          openAtPress.current = false;
          // 开着时点触发器 = 关：ui Menu 在按下时已经在关，这里不再打开。
          if (disabled || wasOpen) return;
          const next = place();
          if (next === null) return;
          setAnchor(next);
          send({ ev: "toggle", sf, id: node.id, open: true });
        }}
      >
        {text === "" ? undefined : text}
        {p.caret === true && text !== "" && <TspIcon name="chev" size={14} />}
      </UiButton>
      {anchor !== null && (
        <UiMenu anchor={anchor} items={items} label={label ?? text} onClose={onClose} testId={MENU_TEST_ID} />
      )}
    </>
  );
}

/** 组里的一个子节点：button 套上组的尺寸，其余（menu、别的）照常画。 */
function GroupChild({ id, ctx, size }: { id: string; ctx: TspContext; size: "sm" | "md" | undefined }) {
  const child = useTspNode(ctx.taskId, ctx.sf, id);
  const sized = useMemo(
    () => (child !== null && child.k === "button" && size !== undefined ? { ...child, p: { ...child.p, size } } : null),
    [child, size],
  );
  if (child === null) return null;
  return sized === null ? <TspNode id={id} ctx={ctx} /> : <Button node={sized} ctx={ctx} />;
}

export function Buttons(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const variant = p.variant === "split" || p.variant === "toolbar" ? p.variant : "joined";
  const size = p.size === "sm" || p.size === "md" ? p.size : undefined;
  const dom = nodeDomProps(props, "tsp-buttons", { pointer: false });
  return (
    <div
      {...dom}
      role={variant === "toolbar" ? "toolbar" : "group"}
      aria-label={typeof p.label === "string" ? p.label : dom["aria-label"]}
      data-variant={variant}
    >
      <GroupSize.Provider value={size}>
        {node.c.map((id) => (
          <GroupChild key={id} id={id} ctx={ctx} size={size} />
        ))}
      </GroupSize.Provider>
    </div>
  );
}
