// 设置 → omp 版本 → omp 更新日志（spec §4.19）：`/changelog` 的 markdown，按版本折叠，只展开最新一节；点开才读（输出很长）。
// 渲染用对话流同一个 Markdown（markdown-it 的 token，不用 dangerouslySetInnerHTML）；链接经主进程打开系统浏览器。
import { useState } from "react";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/Markdown.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Button, Card } from "./controls.tsx";
import { changelogResource } from "./integrations-data.ts";
import "./integrations.css";

const PAGE = 8;

export function OmpChangelog() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = changelogResource.useLoad("changelog");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set([0]));
  const [limit, setLimit] = useState(PAGE);
  const sections = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  const toggleOpen = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <>
      <h3 className="settings-group-title">{t("integrations.changelog.title")}</h3>
      <Card testId="omp-changelog">
        {!shown ? (
          <div className="st-block ig-footer">
            <Button
              disabled={!ready}
              onClick={() => {
                setShown(true);
                void changelogResource.load("changelog");
              }}
              testId="changelog-show"
            >
              {t("integrations.changelog.show")}
            </Button>
            <span className="st-muted">{t("integrations.changelog.hint")}</span>
          </div>
        ) : (
          <>
            {load.kind === "error" && (
              <div className="st-block st-error-text ig-raw" role="alert" data-testid="changelog-failed">
                {t("integrations.loadFailed", { message: errorDetail(load.error) })}
              </div>
            )}
            {sections === null && load.kind !== "error" && (
              <div className="st-block st-muted">{t("integrations.loading")}</div>
            )}
            {sections?.slice(0, limit).map((section, index) => {
              const expanded = open.has(index);
              const label = section.version === null ? t("integrations.changelog.all") : section.version;
              return (
                <div
                  className="st-block"
                  key={`${section.version ?? "all"}-${index}`}
                  data-testid={`changelog-section-${index}`}
                >
                  <button
                    type="button"
                    className="ig-section-head"
                    aria-expanded={expanded}
                    onClick={() => toggleOpen(index)}
                  >
                    <span className="ig-title">{label}</span>
                    {section.date !== null && <span className="st-muted">{section.date}</span>}
                  </button>
                  {expanded && <Markdown source={section.body} />}
                </div>
              );
            })}
            {sections !== null && sections.length > limit && (
              <div className="st-block ig-footer">
                <Button variant="text" onClick={() => setLimit(limit + PAGE)} testId="changelog-more">
                  {t("integrations.changelog.more", { count: sections.length - limit })}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
