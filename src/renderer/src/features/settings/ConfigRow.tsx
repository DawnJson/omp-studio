// omp 的一项设置：默认一行 = 标签（+ ⓘ 说明、"已修改"、保存反馈）和右边的控件（前面是"恢复默认"）。
// 描述放进 ⓘ（悬停/聚焦/点击）；搜索命中的是描述而不是标签时，才在行下面就地显示那一句。
// 常用项显示人话标签；其余显示 key，描述是 omp 原文（中文界面里在 ⓘ 里标"omp 原文"）。
// 只有真有话要说时才多出一行：被覆盖的提示、保存或校验错误。
import { describeError } from "../../ui/errors.ts";
import { memo, useId } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { ConfigControl } from "./ConfigControls.tsx";
import { goalContinuationKey } from "../../../../shared/ui/goal-continuation.ts";
import { enumLabel } from "../../../../shared/ui/config-labels.ts";
import { configText, isModified, shortValue } from "./config-meta.ts";
import { resetOmpConfig, saveOmpConfig, setLocalError, useRowState } from "./config-store.ts";
import { InfoTip } from "./InfoTip.tsx";

export const ConfigRow = memo(function ConfigRow({ item, query = "" }: { item: OmpConfigItem; query?: string }) {
  const t = useT();
  const locale = useLocale();
  const labelId = useId();
  const row = useRowState(item.key);
  const text = configText(locale, item);
  const modified = isModified(item);
  const stacked = (item.type === "array" || item.type === "record") && item.key !== goalContinuationKey;
  const name = text.label ?? item.key;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const nameText = `${name}\n${item.key}`.toLowerCase();
  const snippet =
    words.length > 0 && text.description && !words.every((word) => nameText.includes(word)) ? text.description : null;

  const sources: Record<string, string> = {
    project: t("settings.cfg.source.project"),
    overlay: t("settings.cfg.source.overlay"),
    runtime: t("settings.cfg.source.runtime"),
  };
  const defaultText = item.hasDefault
    ? item.defaultValue === ""
      ? t("settings.cfg.emptyText")
      : item.type === "enum" && typeof item.defaultValue === "string"
        ? enumLabel(locale, item.key, item.defaultValue)
        : shortValue(item.defaultValue)
    : t("settings.cfg.unset");
  const hasTip = text.label !== null || text.description !== "" || item.redacted;

  return (
    <div
      className="cfg-row"
      role="group"
      aria-labelledby={labelId}
      data-stacked={stacked || undefined}
      data-modified={modified || undefined}
      data-testid={`cfg-${item.key}`}
    >
      <div className="cfg-line">
        <div className="cfg-name">
          <span
            id={labelId}
            className={text.label ? "cfg-title" : "cfg-title cfg-key-title"}
            title={text.label ? `${text.label} (${item.key})` : item.key}
          >
            {name}
          </span>
          {hasTip && (
            <InfoTip>
              {text.label && <span className="st-tip-key">{item.key}</span>}
              {text.description}
              {text.original && locale === "zh-CN" && text.description !== "" && (
                <span className="cfg-badge">{t("settings.cfg.original")}</span>
              )}
              {item.redacted && <span className="st-tip-line">{t("settings.cfg.credentialNote")}</span>}
            </InfoTip>
          )}
          {modified && <span className="cfg-chip">{t("settings.cfg.modified")}</span>}
          {(row.overriddenBy || row.fallbackEnv) && (
            <span
              className="cfg-chip cfg-chip-warn"
              title={
                row.overriddenBy
                  ? t("settings.cfg.overridden", {
                      source: sources[row.overriddenBy] ?? t("settings.cfg.source.env", { name: row.overriddenBy }),
                    })
                  : t("settings.cfg.fallbackEnv", { name: row.fallbackEnv ?? "" })
              }
            >
              {t("settings.cfg.overriddenBadge", {
                name: row.overriddenBy ? (sources[row.overriddenBy] ?? row.overriddenBy) : (row.fallbackEnv ?? ""),
              })}
            </span>
          )}
          <span className="cfg-feedback" role="status" aria-live="polite">
            {row.phase === "saving" && t("settings.cfg.saving")}
            {row.phase === "saved" && <span className="cfg-saved">{t("settings.cfg.saved")}</span>}
          </span>
        </div>
        {modified && (
          <button
            type="button"
            className="cfg-reset"
            disabled={row.phase === "saving"}
            title={item.redacted ? undefined : t("settings.cfg.default", { value: defaultText })}
            onClick={() => void resetOmpConfig(item.key)}
          >
            {t("settings.cfg.reset")}
          </button>
        )}
        <div className="cfg-control">
          {item.redacted ? (
            <span className="cfg-credential" data-set={item.hasValue || undefined}>
              {item.hasValue ? t("settings.cfg.credentialSet") : t("settings.cfg.credentialUnset")}
            </span>
          ) : (
            <ConfigControl
              item={item}
              labelId={labelId}
              onSave={(value) => void saveOmpConfig(item.key, value)}
              onInvalid={(message) => setLocalError(item.key, message)}
            />
          )}
        </div>
      </div>
      {snippet && <div className="cfg-snippet">{snippet}</div>}
      {row.phase === "error" && row.error !== undefined && (
        <div className="cfg-error" role="alert">
          {typeof row.error === "string" ? row.error : describeError(t, row.error)}
        </div>
      )}
    </div>
  );
});
