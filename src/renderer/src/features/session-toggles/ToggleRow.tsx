// 会话开关菜单里的一行：名称 + 一句说明 + "本会话"标记 + 和配置默认值不同时的小圆点 + 开关。
import { useId } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Switch } from "../settings/controls.tsx";

export interface ToggleRowProps {
  id: string;
  label: string;
  hint: string;
  /** 生效值；读不到（配置还没载入、omp 没报过）时按关显示。 */
  checked: boolean;
  /** 值来自本会话的命令（不是配置默认值）。 */
  session: boolean;
  /** 本会话值和配置默认值不同。 */
  differs: boolean;
  busy: boolean;
  onChange(next: boolean): void;
}

export function ToggleRow({ id, label, hint, checked, session, differs, busy, onChange }: ToggleRowProps) {
  const t = useT();
  const labelId = useId();
  return (
    <div
      className="tg-row"
      data-testid={`toggle-${id}`}
      data-session={session || undefined}
      data-differs={differs || undefined}
    >
      <div className="tg-text">
        <span id={labelId} className="tg-label">
          {label}
          {differs && (
            <span
              className="tg-dot"
              data-testid={`toggle-${id}-dot`}
              role="img"
              aria-label={t("toggles.differs")}
              title={t("toggles.differs")}
            />
          )}
        </span>
        <span className="tg-hint">{hint}</span>
      </div>
      {session && <span className="tg-session">{t("toggles.session")}</span>}
      <Switch
        checked={checked}
        disabled={busy}
        labelledBy={labelId}
        onChange={onChange}
        testId={`toggle-${id}-switch`}
      />
    </div>
  );
}
