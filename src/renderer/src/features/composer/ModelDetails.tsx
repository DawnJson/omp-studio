// 模型选择对话框底部的参数行，照 Tern：上下文 · 输出 · 价格 · 推理 + 胶囊（当前 / 绑定的角色）。
// 压缩于、速度、智能分、输入类型放在悬停提示里；实测速度、压缩设置来自 getModelInsights（还在读时显示"…"），智能分和目录速度是模型自带的。
import type { ModelInsights, ModelOption } from "../../../../shared/ipc.ts";
import { compactionTrigger, type CompactionTrigger } from "../../../../shared/compaction-trigger.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { modelPriceLine } from "./model-groups.ts";
import { RoleIcon } from "./RoleIcon.tsx";
import { formatCount } from "./usage-format.ts";

interface ModelDetailsProps {
  option: ModelOption;
  isCurrent: boolean;
  /** 指到这个模型的角色。 */
  roles: readonly string[];
  /** null = 还在读。 */
  insights: ModelInsights | null;
}

const loading = "…";
const dollars = (value: number) => `$${Number(value.toFixed(3))}`;

function compactionText(t: TFunction, trigger: CompactionTrigger, count: (value: number) => string): string {
  const how = trigger.capped
    ? t("model.compact.capped")
    : trigger.kind === "fixed"
      ? t("model.compact.fixed")
      : trigger.kind === "percent"
        ? trigger.base === null
          ? t("model.compact.percent", { percent: trigger.percent ?? 0 })
          : t("model.compact.percentOfBase", { percent: trigger.percent ?? 0, base: count(trigger.base) })
        : trigger.base === null
          ? t("model.compact.reserve", { reserve: count(trigger.reserve ?? 0) })
          : t("model.compact.reserveOfBase", { reserve: count(trigger.reserve ?? 0), base: count(trigger.base) });
  return [count(trigger.tokens), how, t(`model.compact.source.${trigger.source}`)].join(" · ");
}

export function ModelDetails({ option, isCurrent, roles, insights }: ModelDetailsProps) {
  const t = useT();
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const count = (value: number) => numberFormat.format(Math.round(value));
  const fullKey = `${option.key.provider}/${option.key.modelId}`;
  const unknown = t("model.unknown");

  const compaction =
    option.contextWindow === null
      ? unknown
      : insights === null
        ? loading
        : insights.compaction === null
          ? unknown
          : compactionText(t, compactionTrigger(insights.compaction, option.key, option.contextWindow), count);

  const { input, output, cacheRead } = option.cost;
  const priceParts = [
    input > 0 && t("model.price.input", { value: dollars(input) }),
    output > 0 && t("model.price.output", { value: dollars(output) }),
    cacheRead > 0 && t("model.price.cache", { value: dollars(cacheRead) }),
  ].filter((part) => part !== false);
  const priceLine = modelPriceLine(option);
  const price = priceLine === null ? t("model.free") : t("model.price.perM", { value: priceLine });

  const perf = insights?.perf[fullKey];
  const speed =
    insights === null
      ? loading
      : perf !== undefined
        ? [
            perf.tokensPerSecond !== null && t("model.perf.tps", { value: count(perf.tokensPerSecond) }),
            perf.ttftMs !== null && t("model.perf.ttft", { value: (perf.ttftMs / 1000).toFixed(1) }),
            t("model.perf.samples", { count: perf.samples }),
          ]
            .filter((part) => part !== false)
            .join(" · ")
        : option.catalogTps !== null
          ? `${t("model.perf.tps", { value: count(option.catalogTps) })} · ${t("model.perf.catalog")}`
          : t("model.perf.none");

  const intelligence = option.intelligence === null ? unknown : count(option.intelligence);
  const inputs = [t("model.input.text"), ...(option.acceptsImages ? [t("model.input.image")] : [])].join(" · ");

  // 行里放不下的参数（压缩于、实测速度明细、智能分、输入类型、完整价格）放在悬停提示里。
  const detail = [
    fullKey,
    `${t("model.compactsAt")}：${compaction}`,
    `${t("model.context")}：${option.contextWindow === null ? unknown : count(option.contextWindow)}`,
    `${t("model.price")}：${priceParts.length === 0 ? t("model.free") : t("model.price.line", { parts: priceParts.join(" · ") })}`,
    `${t("model.perf")}：${speed}`,
    `${t("model.intelligence")}：${intelligence}`,
    `${t("model.input")}：${inputs}`,
  ].join("\n");

  return (
    <p className="mp-params" data-testid="model-details" title={detail}>
      <span className="mp-param">
        <span className="mp-param-label">{t("model.context")}</span>{" "}
        {option.contextWindow === null ? unknown : formatCount(option.contextWindow)}
      </span>
      <span className="mp-param">
        <span className="mp-param-label">{t("model.out")}</span>{" "}
        {option.maxTokens === null ? unknown : formatCount(option.maxTokens)}
      </span>
      <span className="mp-param">
        <span className="mp-param-label">{t("model.price")}</span> {price}
      </span>
      <span className="mp-param">
        <span className="mp-param-label">{t("model.reasoning")}</span>{" "}
        {t(option.reasoning ? "model.supported" : "model.unsupported")}
      </span>
      {option.acceptsImages && <span className="mp-pill">{t("model.tag.vision")}</span>}
      {isCurrent && (
        <span className="mp-pill" data-kind="current">
          {t("model.current")}
        </span>
      )}
      {roles.map((role) => (
        <span key={role} className="mp-pill" data-kind="role">
          <RoleIcon role={role} size={12} />
          {role}
        </span>
      ))}
    </p>
  );
}
