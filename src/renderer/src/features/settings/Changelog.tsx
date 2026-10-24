// 设置 → 关于 → 更新日志（spec §4.19）：omp-studio 和 omp 各一项，都只显示最新一版，默认收起，点开看正文。
// omp-studio 的是当前版本在打包进来的 CHANGELOG.md 里的那一节（AppInfo.releaseNotes）；
// omp 的来自 omp 自带的 `/changelog`（输出很长，点开时才读），取最新的那一节。
// 渲染用对话流同一个 Markdown（markdown-it 的 token，不用 dangerouslySetInnerHTML）；链接经主进程打开系统浏览器。
import { useId, useState, type ReactNode } from "react";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/Markdown.tsx";
import { useAppInfo, useOmpStatus } from "../../store/index.ts";
import { Disclosure, Notice, SectionHead } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { changelogResource } from "./integrations-data.ts";

export function Changelog() {
  const t = useT();
  return (
    <section className="st-section" data-testid="changelog">
      <SectionHead title={t("integrations.changelog.title")} />
      <StudioEntry />
      <OmpEntry />
    </section>
  );
}

function Entry(props: {
  name: string;
  version: string | null;
  date: string | null;
  expanded: boolean;
  onToggle(): void;
  testId: string;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="st-changelog" data-testid={props.testId}>
      <Disclosure
        expanded={props.expanded}
        controls={bodyId}
        onToggle={props.onToggle}
        testId={`${props.testId}-toggle`}
      >
        <span className="st-changelog-name">{props.name}</span>
        {props.version !== null && <span className="st-changelog-version">{props.version}</span>}
        {props.date !== null && <span className="st-muted">{props.date}</span>}
      </Disclosure>
      <Reveal open={props.expanded} id={bodyId}>
        <div className="st-changelog-body">{props.children}</div>
      </Reveal>
    </div>
  );
}

function StudioEntry() {
  const notes = useAppInfo()?.releaseNotes ?? null;
  const [expanded, setExpanded] = useState(false);
  if (notes === null) return null;
  return (
    <Entry
      name="omp-studio"
      version={notes.version}
      date={notes.date}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      testId="changelog-studio"
    >
      <Markdown source={notes.body} />
    </Entry>
  );
}

function OmpEntry() {
  const t = useT();
  const status = useOmpStatus();
  const load = changelogResource.useLoad("changelog");
  const [expanded, setExpanded] = useState(false);
  if (status?.state !== "ready") return null;
  const sections = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;
  const latest = sections?.[0];
  const toggle = () => {
    if (!expanded && (load.kind === "idle" || load.kind === "error")) void changelogResource.load("changelog");
    setExpanded(!expanded);
  };
  return (
    <Entry
      name="omp"
      version={latest?.version ?? status.version}
      date={latest?.date ?? null}
      expanded={expanded}
      onToggle={toggle}
      testId="changelog-omp"
    >
      {load.kind === "error" && (
        <Notice tone="error" testId="changelog-failed">
          {t("integrations.loadFailed", { message: errorDetail(load.error) })}
        </Notice>
      )}
      {sections === null && load.kind !== "error" && <p className="st-muted">{t("integrations.loading")}</p>}
      {latest !== undefined && <Markdown source={latest.body} />}
    </Entry>
  );
}
