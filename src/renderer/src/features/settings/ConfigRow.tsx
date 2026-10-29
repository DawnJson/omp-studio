// omp 的一项设置：一个 ui/Row = 标签（+ ⓘ 说明）| 控件（后面是保存反馈、被覆盖的徽标）| 改过才有的"恢复默认"图标。
// 描述放进 ⓘ（悬停/聚焦/点击）；搜索命中的是描述而不是标签时，才在控件下面就地显示那一句。
// 常用项显示人话标签；其余显示 key（等宽，高级页里去掉小标题已经写出的前缀），描述是 omp 原文。
// 只有真有话要说时才多出一行：保存或校验错误。保存成功弹"已保存"气泡（toast），不在行里占位。
import { Fragment, memo } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { enumLabel } from "../../../../shared/ui/config-labels.ts";
import { Badge, Row } from "../../ui/controls.tsx";
import { describeError } from "../../ui/errors.ts";
import { ConfigControl } from "./ConfigControls.tsx";
import { configText, isModified, shortValue } from "./config-meta.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { resetOmpConfig, saveOmpConfig, setLocalError, useRowState } from "./config-store.ts";

export const ConfigRow = memo(function ConfigRow({
  item,
  query = "",
  keyPrefix = "",
}: {
  item: OmpConfigItem;
  query?: string;
  /** 高级页小标题已经写出的前缀（`providers`）：行里的 key 去掉它。 */
  keyPrefix?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const row = useRowState(item.key);
  const text = configText(locale, item);
  const modified = isModified(item);
  const shownKey =
    keyPrefix !== "" && item.key.startsWith(`${keyPrefix}.`) ? item.key.slice(keyPrefix.length + 1) : item.key;
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
      : item.type === "enum" && typeof item.defaultValue === "string" && text.label !== null
        ? enumLabel(locale, item.key, item.defaultValue)
        : shortValue(item.defaultValue)
    : t("settings.cfg.unset");
  const hasTip = text.label !== null || text.description !== "" || item.redacted;
  const overridden = row.overriddenBy || row.fallbackEnv;
  const toastSaved = (saved: boolean) => saved && pushToast({ message: t("settings.cfg.saved"), durationMs: 1500 });

  return (
    <Row
      label={text.label ?? <span className="st-key">{breakAfterDots(shownKey)}</span>}
      info={
        hasTip ? (
          <>
            {text.label && <span className="ui-info-key">{item.key}</span>}
            {text.description}
            {item.redacted && <span className="ui-info-line">{t("settings.cfg.credentialNote")}</span>}
          </>
        ) : undefined
      }
      modified={modified}
      reset={{
        tip: item.redacted ? t("settings.cfg.reset") : t("settings.cfg.default", { value: defaultText }),
        onReset: () => void resetOmpConfig(item.key).then(toastSaved),
      }}
      testId={`cfg-${item.key}`}
    >
      {(labelId) => (
        <>
          {item.redacted ? (
            <Badge tone={item.hasValue ? "success" : "neutral"}>
              {item.hasValue ? t("settings.cfg.credentialSet") : t("settings.cfg.credentialUnset")}
            </Badge>
          ) : (
            <ConfigControl
              item={item}
              labelId={labelId}
              title={name}
              onSave={(value) => void saveOmpConfig(item.key, value).then(toastSaved)}
              onInvalid={(message) => setLocalError(item.key, message)}
            />
          )}
          {overridden && (
            <Badge
              tone="warning"
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
            </Badge>
          )}
          {snippet && <span className="cfg-note">{snippet}</span>}
          {row.phase === "error" && row.error !== undefined && (
            <span className="cfg-note cfg-error" role="alert">
              {typeof row.error === "string" ? row.error : describeError(t, row.error)}
            </span>
          )}
        </>
      )}
    </Row>
  );
});

/** 长 key 只在点后面折行（compaction.<wbr>modelThresholdsEnabled），不从单词中间断开。 */
function breakAfterDots(key: string) {
  return key.split(".").map((part, index, parts) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </Fragment>
  ));
}
