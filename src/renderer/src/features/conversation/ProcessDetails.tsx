// 展开后的过程（spec 4.11）：每个工具一张 omp 风格卡片（头部：图标 + 名称 + 目标 + 信息 + 状态，hover 出复制 / 展开；卡体默认直接展示 diff / grep 文件卡 / 命令输出 / 行号输出，预览 12 行）、叙述（· 开头单行）、思考。>200 行只渲染最后 100 条。
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronRight, CopyIcon, FileIcon, Pencil, Search, Terminal } from "../../icons.tsx";
import { FileLink } from "../file-preview/index.ts";
import type { Step, ToolStep } from "./model.ts";
import { toolTarget, toolVerb } from "./tool-info.ts";
import {
  bodyLineCount,
  buildBody,
  buildInfo,
  defaultOpen,
  filePaths,
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

const PREVIEW_LINES = 12;
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

/** 复制到剪贴板的纯文本：bash = 命令 + 输出；diff 带 +/− 号；其余按行。 */
function bodyText(body: ToolBody): string {
  switch (body.kind) {
    case "bash":
      return [...(body.command !== null ? [`$ ${body.command}`] : []), ...body.lines].join("\n");
    case "diff":
      return body.rows
        .flatMap((row) =>
          row.kind === "gap" ? [] : [`${row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}${row.text}`],
        )
        .join("\n");
    case "grep":
      return body.files.flatMap((file) => file.rows.map((row) => `${file.path}:${row.no}: ${row.text}`)).join("\n");
    case "numbered":
      return body.rows.map((row) => `${row.no}: ${row.text}`).join("\n");
    case "plain":
      return body.lines.join("\n");
  }
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="step-action"
      title={copied ? t("common.copied") : t("common.copy")}
      aria-label={t("common.copy")}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

const ToolRow = memo(function ToolRow({ step, taskId }: { step: ToolStep; taskId: TaskId }) {
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
  const paths = useMemo(() => filePaths(step.name, step.args), [step.name, step.args]);
  const total = bodyLineCount(body);
  // 命令本身也是内容：bash 还没输出时卡体就先显示 $ 命令。
  const hasContent = defaultOpen(body) || (body.kind === "bash" && body.command !== null) || paths.length > 1;
  const open = override ?? (failed || hasContent);
  const hidden = all ? 0 : Math.max(0, total - PREVIEW_LINES);
  const target = headerTarget(step.name, step.args);
  const duration = step.startedAt !== null && step.endedAt !== null ? step.endedAt - step.startedAt : 0;
  const toggle = () => setOverride(!open);
  // 头部目标：单个文件是可点的文件链接（带行选择器后缀）；多个文件显示个数，文件 chip 在卡体里。
  const single = paths.length === 1 ? (paths[0] ?? null) : null;
  const range = single !== null && target !== null && target.startsWith(single) ? target.slice(single.length) : "";
  return (
    <div className="step-tool" data-anchor data-status={step.status} data-open={open || undefined}>
      <div className="step-head">
        <button
          type="button"
          className="step-row step-toggle"
          aria-expanded={open}
          title={toolLabel(step, t)}
          onClick={toggle}
        >
          <span className="step-icon">
            <Icon size={14} />
          </span>
          <span className="step-name">{toolDisplayName(step.name)}</span>
        </button>
        {single !== null ? (
          <span className="step-arg">
            <FileLink taskId={taskId} path={single} />
            {range !== "" && <span className="step-range">{range}</span>}
          </span>
        ) : paths.length > 1 ? (
          <span className="step-arg">{t("tool.info.readFiles", { count: paths.length })}</span>
        ) : (
          target !== null && (
            <button type="button" className="step-arg step-arg-btn" tabIndex={-1} onClick={toggle}>
              {target}
            </button>
          )
        )}
        <button type="button" className="step-row step-toggle step-fill" tabIndex={-1} onClick={toggle}>
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
        <span className="step-actions">
          {total > 0 && <CopyButton text={bodyText(body)} />}
          <button
            type="button"
            className="step-action"
            aria-label={open ? t("tool.output.collapse") : t("tool.output.showAll")}
            onClick={toggle}
          >
            <ChevronRight size={12} className="step-chevron" data-open={open || undefined} />
          </button>
        </span>
      </div>
      <Reveal open={open}>
        <div className="step-output">
          {paths.length > 1 && (
            <div className="step-chips">
              {paths.map((path) => (
                <span key={path} className="step-chip">
                  <FileIcon size={12} />
                  <FileLink taskId={taskId} path={path} />
                </span>
              ))}
            </div>
          )}
          {total > 0 || (body.kind === "bash" && body.command !== null) ? (
            <div className="step-scroll" data-all={all || undefined}>
              <BodyView body={all ? body : clipBody(body, PREVIEW_LINES)} t={t} />
            </div>
          ) : (
            !running && paths.length <= 1 && <p className="step-empty">{t("tool.output.empty")}</p>
          )}
          {total > PREVIEW_LINES && (
            <div className="step-more">
              {hidden > 0 && <>{t("tool.output.more", { count: hidden })} · </>}
              <button type="button" className="step-showall" onClick={() => setAll(!all)}>
                {all ? t("tool.output.collapse") : t("tool.output.showAll")}
              </button>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
});

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

export function ProcessDetails({
  steps,
  taskId,
  header,
}: {
  steps: readonly Step[];
  taskId: TaskId;
  header?: ReactNode;
}) {
  const t = useT();
  const trimmed = steps.length > MANY ? steps.slice(-KEEP) : steps;
  return (
    <div className="details">
      {header}
      {steps.length > trimmed.length && (
        <p className="details-earlier">{t("process.earlier", { n: steps.length - trimmed.length })}</p>
      )}
      {trimmed.map((step) =>
        step.kind === "tool" ? (
          <ToolRow key={step.key} step={step} taskId={taskId} />
        ) : (
          <TextStepRow key={step.key} step={step} />
        ),
      )}
    </div>
  );
}
