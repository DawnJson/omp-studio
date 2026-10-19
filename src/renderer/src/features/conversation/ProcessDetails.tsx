// 展开后的过程（spec 4.11）：工具行（omp 风格：动词图标 + 名称 + 目标 + 信息 + 计时；正文按工具分 diff 卡 / grep 文件卡 / 命令输出 / 行号输出，预览 10 行）、叙述（· 开头单行）、思考。>200 行只渲染最后 100 条。
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight, FileIcon, Pencil, Search, Terminal } from "../../icons.tsx";
import type { Step, ToolStep } from "./model.ts";
import { toolTarget, toolVerb } from "./tool-info.ts";
import {
  bodyLineCount,
  buildBody,
  buildInfo,
  defaultOpen,
  formatElapsed,
  headerTarget,
  toolDisplayName,
  type DiffRow,
  type GrepFile,
  type ToolBody,
  type ToolInfo,
} from "./tool-view.ts";
import { useNow } from "./use-now.ts";
import { Reveal } from "../../ui/Reveal.tsx";

const PREVIEW_LINES = 10;
const MANY = 200;
const KEEP = 100;

export function toolLabel(step: ToolStep, t: TFunction): string {
  if (step.intent) return step.intent;
  const target = toolTarget(step.args) ?? "";
  switch (toolVerb(step.name)) {
    case "read":
      return t("tool.verb.read", { target });
    case "edit":
      return t("tool.verb.edit", { target });
    case "write":
      return t("tool.verb.write", { target });
    case "bash":
      return t("tool.verb.bash", { target });
    case "search":
      return t("tool.verb.search", { target });
    default:
      return t("tool.verb.other", { tool: step.name });
  }
}

const verbIcon = {
  read: FileIcon,
  write: FileIcon,
  edit: Pencil,
  bash: Terminal,
  search: Search,
  other: ChevronRight,
} as const;

function InfoSegment({ info }: { info: ToolInfo }) {
  const t = useT();
  switch (info.kind) {
    case "search":
      return (
        <span className="step-info">
          {t("tool.info.matches", { count: info.matches })} · {t("tool.info.files", { count: info.files })}
        </span>
      );
    case "diff":
      return (
        <span className="step-info">
          <span className="step-add">+{info.added}</span> <span className="step-del">−{info.removed}</span>
        </span>
      );
    case "task":
      return (
        <>
          {info.agents !== null && <span className="step-info">{t("tool.info.agents", { count: info.agents })}</span>}
          {info.background && <span className="step-pill">{t("tool.info.background")}</span>}
        </>
      );
  }
}

/** 行号列宽：按最大行号的位数，卡片内所有行对齐。 */
function gutter(max: number): CSSProperties {
  return { "--gutter": `${Math.max(2, String(max).length)}ch` } as CSSProperties;
}

function DiffLines({ rows, t }: { rows: readonly DiffRow[]; t: TFunction }) {
  return (
    <div
      className="step-lines"
      style={gutter(
        rows.reduce((max, row) => (row.kind === "gap" ? max : Math.max(max, row.oldNo ?? 0, row.newNo ?? 0)), 0),
      )}
    >
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={index} className="step-ln" data-kind="gap">
            <span className="step-gap">··· {t("tool.output.unchanged", { count: row.count })}</span>
          </div>
        ) : (
          <div key={index} className="step-ln" data-kind={row.kind}>
            <span className="step-no">{row.oldNo}</span>
            <span className="step-no">{row.newNo}</span>
            <span className="step-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
            <span className="step-code">{row.text}</span>
          </div>
        ),
      )}
    </div>
  );
}

function GrepFiles({ files }: { files: readonly GrepFile[] }) {
  return (
    <>
      {files.map((file, index) => (
        <div key={`${file.path}:${index}`} className="step-file">
          <div className="step-file-head">
            <FileIcon size={12} />
            <span className="step-file-path">{file.path}</span>
            <span className="step-pill">{file.matches}</span>
          </div>
          <div className="step-lines" style={gutter(file.rows.reduce((max, row) => Math.max(max, row.no), 0))}>
            {file.rows.map((row) => (
              <div key={row.no} className="step-ln" data-kind={row.match ? "match" : "ctx"}>
                <span className="step-no">{row.no}</span>
                <span className="step-code">{row.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** 预览只取前 limit 行（diff 的间隔行也算一行；grep 跨文件累计）。 */
function clipBody(body: ToolBody, limit: number): ToolBody {
  switch (body.kind) {
    case "diff":
      return { kind: "diff", rows: body.rows.slice(0, limit) };
    case "grep": {
      let left = limit;
      const files: GrepFile[] = [];
      for (const file of body.files) {
        if (left <= 0) break;
        files.push({ ...file, rows: file.rows.slice(0, left) });
        left -= file.rows.length;
      }
      return { kind: "grep", files };
    }
    case "bash":
      return { kind: "bash", command: body.command, lines: body.lines.slice(0, limit) };
    case "numbered":
      return { kind: "numbered", rows: body.rows.slice(0, limit) };
    case "plain":
      return { kind: "plain", lines: body.lines.slice(0, limit) };
  }
}

function BodyView({ body, t }: { body: ToolBody; t: TFunction }) {
  switch (body.kind) {
    case "diff":
      return <DiffLines rows={body.rows} t={t} />;
    case "grep":
      return <GrepFiles files={body.files} />;
    case "bash":
      return (
        <div className="step-lines">
          {body.command !== null && (
            <div className="step-ln" data-kind="cmd">
              <span className="step-sign">$</span>
              <span className="step-code">{body.command}</span>
            </div>
          )}
          {body.lines.map((line, index) => (
            <div key={index} className="step-ln">
              <span className="step-code">{line}</span>
            </div>
          ))}
        </div>
      );
    case "numbered":
      return (
        <div className="step-lines" style={gutter(body.rows.reduce((max, row) => Math.max(max, row.no), 0))}>
          {body.rows.map((row, index) => (
            <div key={index} className="step-ln">
              <span className="step-no">{row.no}</span>
              <span className="step-code">{row.text}</span>
            </div>
          ))}
        </div>
      );
    case "plain":
      return (
        <div className="step-lines">
          {body.lines.map((line, index) => (
            <div key={index} className="step-ln">
              <span className="step-code">{line}</span>
            </div>
          ))}
        </div>
      );
  }
}

function ToolRow({ step }: { step: ToolStep }) {
  const t = useT();
  const failed = step.status === "error";
  const running = step.status === "running";
  const now = useNow(running);
  const [override, setOverride] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  const Icon = verbIcon[toolVerb(step.name)];
  const body = useMemo(
    () => buildBody(step.name, step.args, step.result, step.output),
    [step.name, step.args, step.result, step.output],
  );
  const info = buildInfo(step.name, step.args, body);
  const open = override ?? (failed || defaultOpen(step.name, body));
  const total = bodyLineCount(body);
  const hidden = all ? 0 : Math.max(0, total - PREVIEW_LINES);
  const target = headerTarget(step.name, step.args);
  const duration = step.startedAt !== null && step.endedAt !== null ? step.endedAt - step.startedAt : 0;
  return (
    <div className="step-tool" data-anchor data-status={step.status}>
      <button
        type="button"
        className="step-row"
        aria-expanded={open}
        title={toolLabel(step, t)}
        onClick={() => setOverride(!open)}
      >
        <span className="step-icon">
          <Icon size={14} />
        </span>
        <span className="step-name">{toolDisplayName(step.name)}</span>
        {target !== null && <span className="step-arg">{target}</span>}
        {info !== null && <InfoSegment info={info} />}
        <span className="step-meta" data-failed={failed || undefined}>
          {failed ? (
            t("tool.failed")
          ) : running ? (
            <>
              <span className="step-spin" aria-hidden="true" />
              {step.startedAt !== null && formatElapsed(now - step.startedAt)}
            </>
          ) : duration >= 1000 ? (
            formatElapsed(duration)
          ) : null}
        </span>
      </button>
      <Reveal open={open}>
        <div className="step-output">
          {total === 0 ? (
            <p className="step-empty">{t("tool.output.empty")}</p>
          ) : (
            <div className="step-scroll" data-all={all || undefined}>
              <BodyView body={all ? body : clipBody(body, PREVIEW_LINES)} t={t} />
            </div>
          )}
          {hidden > 0 && (
            <div className="step-more">
              {t("tool.output.more", { count: hidden })} ·{" "}
              <button type="button" className="step-showall" onClick={() => setAll(true)}>
                {t("tool.output.showAll")}
              </button>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}

function TextStepRow({ step }: { step: Extract<Step, { kind: "narration" | "thinking" }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const thinking = step.kind === "thinking";
  if (step.text.trim() === "") return null;
  return (
    <div className="step-text" data-anchor data-kind={step.kind}>
      <button type="button" className="step-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="step-icon">{thinking ? "" : "·"}</span>
        <span className="step-label" data-muted>
          {thinking ? `${t("process.thoughtShort")} · ${step.text.trim().split("\n")[0]}` : step.text.split("\n")[0]}
        </span>
      </button>
      <Reveal open={open}>
        <div className="step-full">{step.text}</div>
      </Reveal>
    </div>
  );
}

export function ProcessDetails({ steps, header }: { steps: readonly Step[]; header?: ReactNode }) {
  const t = useT();
  const trimmed = steps.length > MANY ? steps.slice(-KEEP) : steps;
  return (
    <div className="details">
      {header}
      {steps.length > trimmed.length && (
        <p className="details-earlier">{t("process.earlier", { n: steps.length - trimmed.length })}</p>
      )}
      {trimmed.map((step) =>
        step.kind === "tool" ? <ToolRow key={step.key} step={step} /> : <TextStepRow key={step.key} step={step} />,
      )}
    </div>
  );
}
