// 会话开关菜单里的一行：名称 + "本会话"标记 + 和配置默认值不同时的小圆点 + 开关；有后果要交代的行把说明放进悬停（tip）。
import { useId } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Switch } from "../../ui/controls.tsx";

export interface ToggleRowProps {
  id: string;
  label: string;
  /** 悬停说明；没有后果要交代的行不给。 */
  tip?: string | undefined;
  /** 生效值；读不到（配置还没载入、omp 没报过）时按关显示。 */
  checked: boolean;
  /** 值来自本会话的命令（不是配置默认值）。 */
  session: boolean;
  /** 本会话值和配置默认值不同。 */
  differs: boolean;
  busy: boolean;
  onChange(next: boolean): void;
}

export function ToggleRow({ id, label, tip, checked, session, differs, busy, onChange }: ToggleRowProps) {
  const t = useT();
  const labelId = useId();
  return (
    <div
      className="tg-row"
      data-testid={`toggle-${id}`}
      data-session={session || undefined}
      data-differs={differs || undefined}
    >
      <div className="tg-text" title={tip}>
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
      </div>
      {session && (
        <Badge tone="accent" testId={`toggle-${id}-session`}>
          {t("toggles.session")}
        </Badge>
      )}
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
