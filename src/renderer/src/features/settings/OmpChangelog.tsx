// 设置 → 关于 → omp 更新日志（spec §4.19）：`/changelog` 的 markdown，按版本折叠，只展开最新一节；点开才读（输出很长）。
// 渲染用对话流同一个 Markdown（markdown-it 的 token，不用 dangerouslySetInnerHTML）；链接经主进程打开系统浏览器。
import { useState } from "react";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/Markdown.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Button, Disclosure, Notice, SectionHead } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { changelogResource } from "./integrations-data.ts";

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
    <section className="st-section" data-testid="omp-changelog">
      <SectionHead
        title={t("integrations.changelog.title")}
        note={shown ? undefined : t("integrations.changelog.hint")}
        actions={
          !shown && (
            <Button
              size="sm"
              disabled={!ready}
              onClick={() => {
                setShown(true);
                void changelogResource.load("changelog");
              }}
              testId="changelog-show"
            >
              {t("integrations.changelog.show")}
            </Button>
          )
        }
      />
      {shown && (
        <>
          {load.kind === "error" && (
            <Notice tone="error" testId="changelog-failed">
              {t("integrations.loadFailed", { message: errorDetail(load.error) })}
            </Notice>
          )}
          {sections === null && load.kind !== "error" && <p className="st-muted">{t("integrations.loading")}</p>}
          {sections?.slice(0, limit).map((section, index) => {
            const expanded = open.has(index);
            const label = section.version === null ? t("integrations.changelog.all") : section.version;
            const bodyId = `changelog-body-${index}`;
            return (
              <div
                className="st-changelog"
                key={`${section.version ?? "all"}-${index}`}
                data-testid={`changelog-section-${index}`}
              >
                <Disclosure expanded={expanded} controls={bodyId} onToggle={() => toggleOpen(index)}>
                  <span className="st-changelog-version">{label}</span>
                  {section.date !== null && <span className="st-muted">{section.date}</span>}
                </Disclosure>
                <Reveal open={expanded} id={bodyId}>
                  <Markdown source={section.body} />
                </Reveal>
              </div>
            );
          })}
          {sections !== null && sections.length > limit && (
            <Button variant="quiet" size="sm" onClick={() => setLimit(limit + PAGE)} testId="changelog-more">
              {t("integrations.changelog.more", { count: sections.length - limit })}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
