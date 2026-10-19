// 模型选择对话框右栏的参数，照终端版 omp `/models` 的详情：标签（当前 / 推理 / 视觉）+ 上下文、压缩于、最大输出、价格、
// 实测速度、智能分、输入类型、推理。速度、智能分、压缩设置来自 getModelInsights（还在读时显示"…"）。
import type { ModelInsights, ModelOption } from "../../../../shared/ipc.ts";
import { compactionTrigger, type CompactionTrigger } from "../../../../shared/compaction-trigger.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";

interface ModelDetailsProps {
  option: ModelOption;
  isCurrent: boolean;
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

export function ModelDetails({ option, isCurrent, insights }: ModelDetailsProps) {
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
  const price = priceParts.length === 0 ? t("model.free") : t("model.price.line", { parts: priceParts.join(" · ") });

  const perf = insights?.perf[fullKey];
  const speed =
    insights === null
      ? loading
      : perf === undefined
        ? t("model.perf.none")
        : [
            perf.tokensPerSecond !== null && t("model.perf.tps", { value: count(perf.tokensPerSecond) }),
            perf.ttftMs !== null && t("model.perf.ttft", { value: (perf.ttftMs / 1000).toFixed(1) }),
            perf.samples > 0 ? t("model.perf.samples", { count: perf.samples }) : t("model.perf.catalog"),
          ]
            .filter((part) => part !== false)
            .join(" · ");

  const score = insights?.intelligence[fullKey];
  const intelligence = insights === null ? loading : score === undefined ? unknown : count(score);
  const inputs = [t("model.input.text"), ...(option.acceptsImages ? [t("model.input.image")] : [])].join(" · ");

  return (
    <>
      <h3 className="mp-name">{option.name}</h3>
      <p className="mp-id">{fullKey}</p>
      {(isCurrent || option.reasoning || option.acceptsImages) && (
        <p className="mp-tags">
          {isCurrent && (
            <span className="mp-tag" data-kind="current">
              {t("model.current")}
            </span>
          )}
          {option.reasoning && <span className="mp-tag">{t("model.tag.reasoning")}</span>}
          {option.acceptsImages && <span className="mp-tag">{t("model.tag.vision")}</span>}
        </p>
      )}
      <dl className="mp-params">
        <dt>{t("model.context")}</dt>
        <dd>{option.contextWindow === null ? unknown : count(option.contextWindow)}</dd>
        <dt>{t("model.compactsAt")}</dt>
        <dd data-testid="model-compacts-at">{compaction}</dd>
        <dt>{t("model.maxOutput")}</dt>
        <dd>{option.maxTokens === null ? unknown : count(option.maxTokens)}</dd>
        <dt>{t("model.price")}</dt>
        <dd>{price}</dd>
        <dt>{t("model.perf")}</dt>
        <dd data-testid="model-speed">{speed}</dd>
        <dt>{t("model.intelligence")}</dt>
        <dd data-testid="model-intelligence">{intelligence}</dd>
        <dt>{t("model.input")}</dt>
        <dd>{inputs}</dd>
        <dt>{t("model.reasoning")}</dt>
        <dd>{t(option.reasoning ? "model.supported" : "model.unsupported")}</dd>
      </dl>
    </>
  );
}
