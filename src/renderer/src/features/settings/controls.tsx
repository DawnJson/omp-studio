// 设置页和 omp 准备页共用的小控件：按钮、开关、分段选择、下拉、设置行。样式在 settings.css，只用 token。
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Dropdown } from "./Dropdown.tsx";
import { InfoTip } from "./InfoTip.tsx";

type ButtonVariant = "primary" | "secondary" | "text" | "danger";

interface ButtonProps {
  variant?: ButtonVariant;
  large?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  /** 加载中：显示环，按钮宽度不变。 */
  loading?: boolean;
  onClick(): void;
  children: ReactNode;
  testId?: string;
}

export function Button({
  variant = "secondary",
  large = false,
  autoFocus = false,
  disabled = false,
  loading = false,
  onClick,
  children,
  testId,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`st-btn st-btn-${variant}`}
      data-large={large || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      autoFocus={autoFocus}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="st-btn-label">{children}</span>
      {loading && <span className="st-spinner" aria-hidden="true" />}
    </button>
  );
}

export function Switch({
  checked,
  disabled = false,
  labelledBy,
  onChange,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  labelledBy: string;
  onChange(next: boolean): void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="st-switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span className="st-switch-thumb" />
    </button>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** 三五个选项的互斥选择：role=radiogroup，左右键移动并选中。 */
export function Segmented<T extends string>({
  value,
  options,
  labelledBy,
  onChange,
  testId,
}: {
  value: T;
  options: readonly Option<T>[];
  labelledBy: string;
  onChange(next: T): void;
  testId?: string;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
    buttons?.[(index + step + options.length) % options.length]?.focus();
  };
  return (
    <div role="radiogroup" className="st-segmented" aria-labelledby={labelledBy} data-testid={testId}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  labelledBy,
  disabled = false,
  onChange,
  testId,
}: {
  value: T;
  options: readonly Option<T>[];
  labelledBy: string;
  disabled?: boolean;
  onChange(next: T): void;
  testId?: string;
}) {
  return (
    <Dropdown
      value={value}
      options={options}
      labelledBy={labelledBy}
      disabled={disabled}
      onChange={onChange}
      {...(testId !== undefined && { testId })}
    />
  );
}

/** 一行设置：左边标题（有说明时标题后面一个 ⓘ），右边控件。children 是 (labelId) => 控件，让控件用 aria-labelledby 指向标题。 */
export function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="st-row">
      <div className="st-row-text">
        <span id={labelId} className="st-row-title">
          {title}
        </span>
        {desc && <InfoTip>{desc}</InfoTip>}
      </div>
      <div className="st-row-control">{children(labelId)}</div>
    </div>
  );
}

export function Card({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="st-card" data-testid={testId}>
      {children}
    </div>
  );
}
