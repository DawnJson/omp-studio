// 通用控件（spec §4.23）：按钮、图标按钮、开关、勾选框、单选、分段、标签页、徽标、提示条、输入框、分组标题、设置行、列表行、展开。
// 样式全在 ui/controls.css（类名前缀 ui-）；功能目录不再自己写这些控件的样式。下拉在 Select.tsx，菜单 Menu.tsx，
// 浮层 Popover.tsx，对话框 Dialog.tsx，ⓘ 说明 InfoTip.tsx。
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronRight, Reset } from "../icons.tsx";
import { InfoTip } from "./InfoTip.tsx";

export type ControlSize = "md" | "sm";

/** 默认 secondary（透明底 + 描边）；primary 一个视图最多一个；danger-solid 只给破坏性确认框的确认键。 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-solid";

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;

export interface ButtonProps extends NativeButton {
  variant?: ButtonVariant | undefined;
  size?: ControlSize | undefined;
  /** 加载中：文字隐藏、宽度不变，中间一个环；同时禁用。 */
  loading?: boolean | undefined;
  /** 按钮里尾随的快捷键提示（淡色等宽小字，不画键帽框），如门的 "Esc"。 */
  hint?: string | undefined;
  /** 文字前的 14px 图标。 */
  icon?: ReactNode | undefined;
  testId?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  hint,
  icon,
  testId,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={className ? `ui-btn ${className}` : "ui-btn"}
      data-variant={variant === "secondary" ? undefined : variant}
      data-size={size === "sm" ? "sm" : undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled === true || loading}
      data-testid={testId}
      {...rest}
    >
      {icon}
      {children}
      {hint !== undefined && <span className="ui-hint">{hint}</span>}
    </button>
  );
}

export interface IconButtonProps extends Omit<NativeButton, "aria-label" | "title"> {
  /** 读屏名和悬停提示（图标按钮必须有）。 */
  label: string;
  /** 悬停提示另写（如带上快捷键、上次更新时间）；默认同 label。 */
  tip?: string | undefined;
  size?: ControlSize | undefined;
  pressed?: boolean | undefined;
  expanded?: boolean | undefined;
  testId?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function IconButton({
  label,
  tip,
  size = "sm",
  pressed,
  expanded,
  testId,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={className ? `ui-icon-btn ${className}` : "ui-icon-btn"}
      data-size={size === "md" ? "md" : undefined}
      aria-label={label}
      title={tip ?? label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      data-testid={testId}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 读屏名：给 label（aria-label）或 labelledBy（指向页面上的标题）其一。 */
interface Labelled {
  label?: string | undefined;
  labelledBy?: string | undefined;
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  labelledBy,
  testId,
}: Labelled & {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean | undefined;
  testId?: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="ui-switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    />
  );
}

interface ChoiceProps {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean | undefined;
  /** 给了就包成 `<label class="ui-choice">`：点文字也能切换。 */
  children?: ReactNode | undefined;
  label?: string | undefined;
  testId?: string | undefined;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled,
  children,
  label,
  testId,
}: ChoiceProps & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const input = (
    <input
      ref={ref}
      type="checkbox"
      className="ui-check"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.currentTarget.checked)}
      data-testid={testId}
    />
  );
  if (children === undefined) return input;
  return (
    <label className="ui-choice">
      {input}
      {children}
    </label>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** 方向键的步长：右 / 下 +1，左 / 上 -1，其余 0。 */
function arrowStep(event: KeyboardEvent): number {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") return 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") return -1;
  return 0;
}

/** 分段：设一个值（≤4 个短选项；更多用 Select）。role=radiogroup，方向键移动并选中。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  disabled = false,
  mono = false,
  label,
  labelledBy,
  testId,
}: Labelled & {
  value: T;
  options: readonly Option<T>[];
  onChange(next: T): void;
  size?: ControlSize | undefined;
  disabled?: boolean | undefined;
  /** 取值原样显示（omp 的枚举值）用等宽字。 */
  mono?: boolean | undefined;
  testId?: string | undefined;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = arrowStep(event);
    if (step === 0) return;
    event.preventDefault();
    const target = (index + step + options.length) % options.length;
    const next = options[target];
    if (!next) return;
    onChange(next.value);
    event.currentTarget.parentElement?.querySelectorAll("button")[target]?.focus();
  };
  const current = options.some((option) => option.value === value) ? value : options[0]?.value;
  return (
    <div
      role="radiogroup"
      className={mono ? "ui-seg ui-mono" : "ui-seg"}
      data-size={size === "sm" ? "sm" : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-testid={testId}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === current ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, index)}
          data-testid={testId === undefined ? undefined : `${testId}-${option.value}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Tab<T extends string> {
  id: T;
  label: string;
  count?: number | undefined;
  disabled?: boolean | undefined;
  /** 悬停提示。 */
  title?: string | undefined;
}

/** 标签页：切一个视图。role=tablist，方向键移动并切换。面板的 id 是 `${idBase}-panel-${tab}`，用 tabPanelProps 取。 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
  testId,
}: {
  tabs: readonly Tab<T>[];
  value: T;
  onChange(next: T): void;
  label: string;
  idBase: string;
  testId?: string | undefined;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "Home" ? -index : event.key === "End" ? tabs.length - 1 - index : arrowStep(event);
    if (step === 0) return;
    event.preventDefault();
    const target = (index + step + tabs.length) % tabs.length;
    const next = tabs[target];
    if (!next || next.disabled === true) return;
    onChange(next.id);
    event.currentTarget.parentElement?.querySelectorAll("button")[target]?.focus();
  };
  return (
    <div role="tablist" className="ui-tabs" aria-label={label} data-testid={testId}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          className="ui-tab"
          aria-selected={tab.id === value}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          disabled={tab.disabled}
          title={tab.title}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
          data-testid={testId === undefined ? undefined : `${testId}-${tab.id}`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ui-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** 标签页对应面板的属性（和 Tabs 用同一个 idBase）。 */
export function tabPanelProps(idBase: string, tab: string) {
  return { role: "tabpanel", id: `${idBase}-panel-${tab}`, "aria-labelledby": `${idBase}-tab-${tab}` } as const;
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "error";

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
  testId,
}: {
  tone?: Tone | undefined;
  dot?: boolean | undefined;
  children: ReactNode;
  title?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <span className="ui-badge" data-tone={tone === "neutral" ? undefined : tone} title={title} data-testid={testId}>
      {dot && <span className="ui-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** 内联提示条：一句人话 + 最多一个动作。info 用强调色，warning 琥珀，error 红。 */
export function Notice({
  tone = "info",
  children,
  action,
  testId,
}: {
  tone?: "info" | "warning" | "error" | undefined;
  children: ReactNode;
  action?: ReactNode | undefined;
  testId?: string | undefined;
}) {
  return (
    <div
      className="ui-notice"
      data-tone={tone === "info" ? undefined : tone}
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
    >
      <p>{children}</p>
      {action}
    </div>
  );
}

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size" | "width">;

export interface TextFieldProps extends NativeInput {
  value: string;
  onChange(next: string): void;
  size?: ControlSize | undefined;
  /** CSS 宽度（默认 280px）；"100%" 撑满。 */
  width?: number | string | undefined;
  invalid?: boolean | undefined;
  mono?: boolean | undefined;
  /** 框内左侧（搜索图标）/ 右侧（清空按钮、单位）。 */
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  testId?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}

function fieldStyle(width: number | string | undefined) {
  if (width === undefined) return undefined;
  return { "--field-w": typeof width === "number" ? `${width}px` : width } as Record<string, string>;
}

/** 文本 / 搜索框：32 高（sm 28）。点框内空白处也聚焦输入。 */
export function TextField({
  value,
  onChange,
  size = "md",
  width,
  invalid = false,
  mono = false,
  leading,
  trailing,
  testId,
  className,
  disabled,
  ref,
  ...rest
}: TextFieldProps) {
  const own = useRef<HTMLInputElement | null>(null);
  return (
    <span
      className={["ui-field", mono && "ui-mono", className].filter(Boolean).join(" ")}
      data-size={size === "sm" ? "sm" : undefined}
      data-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      style={fieldStyle(width)}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        own.current?.focus();
      }}
    >
      {leading}
      <input
        ref={(node) => {
          own.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        data-testid={testId}
        {...rest}
      />
      {trailing}
    </span>
  );
}

/** 数字框：112 宽、右对齐、等宽数字，单位写在框内。值按字符串进出，解析 / 校验由调用方做。 */
export function NumberField({ unit, width = 112, ...rest }: TextFieldProps & { unit?: string | undefined }) {
  return (
    <TextField
      {...rest}
      width={width}
      inputMode="decimal"
      className="ui-number"
      trailing={unit === undefined ? rest.trailing : <span className="ui-affix">{unit}</span>}
    />
  );
}

type NativeTextarea = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">;

export function Textarea({
  value,
  onChange,
  invalid = false,
  mono = false,
  testId,
  className,
  ref,
  ...rest
}: NativeTextarea & {
  value: string;
  onChange(next: string): void;
  invalid?: boolean | undefined;
  mono?: boolean | undefined;
  testId?: string | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}) {
  return (
    <textarea
      ref={ref}
      className={["ui-textarea", mono && "ui-mono", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      data-testid={testId}
      {...rest}
    />
  );
}

/** 表单里竖排的一个字段：标签在上，控件，帮助文字或错误在下。htmlFor 指向控件的 id。 */
export function FormField({
  label,
  htmlFor,
  help,
  error,
  children,
  testId,
  className,
}: {
  label: ReactNode;
  htmlFor?: string | undefined;
  help?: ReactNode | undefined;
  error?: string | null | undefined;
  children: ReactNode;
  testId?: string | undefined;
  /** 追加的类名（只放布局，如在两栏表单里占满一行）。 */
  className?: string | undefined;
}) {
  return (
    <div className={className ? `ui-form-field ${className}` : "ui-form-field"} data-testid={testId}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="ui-help" data-tone="error" role="alert">
          {error}
        </p>
      ) : (
        help !== undefined && <p className="ui-help">{help}</p>
      )}
    </div>
  );
}

/** 分组标题：13px 粗 + 计数，右侧图标按钮或一个 sm 按钮；note 是标题下一行说明。 */
export function SectionHead({
  title,
  count,
  actions,
  note,
  id,
  testId,
}: {
  title: ReactNode;
  count?: number | string | undefined;
  actions?: ReactNode | undefined;
  note?: ReactNode | undefined;
  id?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <>
      <div className="ui-section-head" data-testid={testId}>
        <h3 className="ui-section-title" id={id}>
          {title}
        </h3>
        {count !== undefined && <span className="ui-count">{count}</span>}
        {actions !== undefined && <div className="ui-section-actions">{actions}</div>}
      </div>
      {note !== undefined && <p className="ui-section-note">{note}</p>}
    </>
  );
}

/**
 * 一行设置：标签（有说明时后面一个 ⓘ）| 控件 | 恢复默认（改过才有）。children 是 (labelId) => 控件，
 * 控件用 aria-labelledby 指向标签。modified 时左侧一道强调色竖线。
 */
export function Row({
  label,
  info,
  modified = false,
  reset,
  children,
  testId,
}: {
  label: ReactNode;
  info?: ReactNode | undefined;
  modified?: boolean | undefined;
  /** 恢复默认：tip 是悬停提示（写出默认值）。 */
  reset?: { tip: string; onReset(): void } | undefined;
  children: (labelId: string) => ReactNode;
  testId?: string | undefined;
}) {
  const labelId = useId();
  return (
    <div className="ui-row" data-modified={modified || undefined} data-testid={testId}>
      <span className="ui-row-label">
        <span id={labelId} className={info === undefined ? undefined : "ui-info-lead"}>
          {label}
        </span>
        {info !== undefined && <InfoTip>{info}</InfoTip>}
      </span>
      <span className="ui-row-control">{children(labelId)}</span>
      {modified && reset !== undefined ? (
        <IconButton label={reset.tip} onClick={reset.onReset} testId={testId && `${testId}-reset`}>
          <Reset />
        </IconButton>
      ) : (
        <span />
      )}
    </div>
  );
}

/** 管理列表的一行：28px 图标、名称（+ 徽标）、一行元信息、动作（删除 / 移除收进 ⋯ 菜单）。 */
export function ListRow({
  icon,
  title,
  badges,
  meta,
  actions,
  testId,
}: {
  icon?: ReactNode | undefined;
  title: ReactNode;
  badges?: ReactNode | undefined;
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  testId?: string | undefined;
}) {
  return (
    <div
      className="ui-list-row"
      data-no-actions={actions === undefined || actions === null || actions === false || undefined}
      data-testid={testId}
    >
      <span className="ui-list-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ui-list-main">
        <span className="ui-list-title">
          <span className="ui-list-name">{title}</span>
          {badges}
        </span>
        {meta !== undefined && <span className="ui-list-meta">{meta}</span>}
      </span>
      <span className="ui-list-actions">{actions}</span>
    </div>
  );
}

/** 展开 / 收起：chevron 转 90°。展开的内容用 ui/Reveal.tsx 包。 */
export function Disclosure({
  expanded,
  onToggle,
  controls,
  children,
  testId,
}: {
  expanded: boolean;
  onToggle(): void;
  controls?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
}) {
  return (
    <button
      type="button"
      className="ui-disclosure"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      data-testid={testId}
    >
      <ChevronRight />
      {children}
    </button>
  );
}
