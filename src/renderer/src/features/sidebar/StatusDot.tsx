// 状态图标（spec §4.1）：16×16 槽位里放 14px 的图标，形状 + 颜色双信号——进行中是转动的弧，需要介入是琥珀圆底 !，
// 失败是红圆底 ×，历史会话中断（停在工具调用 / 长度上限）是虚线圈里一个暂停号，后台跑完还没看过是 accent 小圆点。
// 看过的正常结束、从没跑过和被停止的不画，但槽位保留让标题对齐。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { SessionSummary, TaskState } from "../../../../shared/ipc.ts";
import { dotKind, sessionDotKind, type DotKind } from "../../../../shared/ui/sidebar-model.ts";
import { useRef } from "react";
import { usePresence } from "../../ui/presence.ts";

type Kind = Exclude<DotKind, "none">;

function Glyph({ kind }: { kind: Kind }) {
  switch (kind) {
    case "running":
      return (
        <>
          <circle className="sb-dot-track" cx="8" cy="8" r="6" />
          <circle className="sb-dot-arc" cx="8" cy="8" r="6" pathLength="100" />
        </>
      );
    case "waiting":
      return (
        <>
          <circle className="sb-dot-fill" cx="8" cy="8" r="7" />
          <rect className="sb-dot-ink" x="7.1" y="3.6" width="1.8" height="5.4" rx="0.9" />
          <circle className="sb-dot-ink" cx="8" cy="11.6" r="1.05" />
        </>
      );
    case "error":
      return (
        <>
          <circle className="sb-dot-fill" cx="8" cy="8" r="7" />
          <path className="sb-dot-ink-stroke" d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" />
        </>
      );
    case "interrupted":
      return (
        <>
          <circle className="sb-dot-ring sb-dot-dashed" cx="8" cy="8" r="6.25" />
          <path className="sb-dot-stroke" d="M6.4 5.6v4.8M9.6 5.6v4.8" />
        </>
      );
    case "unread":
      return <circle className="sb-dot-fill" cx="8" cy="8" r="3.5" />;
  }
}

/**
 * 按形状画一个状态图标；none 只留槽位。任务和历史会话共用。`title` = 悬停说明（图标本身只有形状和颜色）。
 * 换种类时按种类换 key，新图标淡入；变成 none（看过了、跑完了）时最后那个图标淡出再只留槽位。
 */
function StatusMark({ kind, label, title }: { kind: DotKind; label: string; title?: string }) {
  const presence = usePresence(kind !== "none", "fade");
  const last = useRef<{ kind: Kind; label: string; title: string | undefined } | null>(null);
  if (kind !== "none") last.current = { kind, label, title };
  const shown = kind !== "none" ? { kind, label, title } : presence.mounted ? last.current : null;
  if (shown === null) return <span key="none" className="sb-dot" aria-hidden="true" />;
  const mark = (
    <svg className="sb-dot-mark" viewBox="0 0 16 16" aria-hidden="true">
      <Glyph kind={shown.kind} />
    </svg>
  );
  return (
    <span
      key={shown.kind}
      className={`sb-dot sb-dot-${shown.kind}`}
      role="img"
      aria-label={shown.label}
      title={shown.title}
      {...presence.exitProps}
    >
      {/* 运行中的弧转动：转外面这层 HTML 盒子（sidebar.css 的 .sb-dot-turn），SVG 的 transform 动画不能交给合成器 */}
      {shown.kind === "running" ? <span className="sb-dot-turn">{mark}</span> : mark}
    </span>
  );
}

export function StatusDot({ task, t }: { task: TaskState; t: TFunction }) {
  const kind = dotKind(task);
  const label =
    kind === "running"
      ? t("status.running")
      : kind === "waiting"
        ? t("status.waiting")
        : kind === "unread"
          ? t("status.unread")
          : t("status.error");
  return <StatusMark kind={kind} label={label} />;
}

/** 历史会话的状态图标：失败、中断两种（见 sessionDotKind）；中断悬停说明是怎么回事。 */
export function SessionStatusDot({ session, t }: { session: SessionSummary; t: TFunction }) {
  const kind = sessionDotKind(session);
  if (kind === "interrupted")
    return <StatusMark kind={kind} label={t("status.interrupted")} title={t("status.interrupted")} />;
  return <StatusMark kind={kind} label={t("status.error")} />;
}
