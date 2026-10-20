// 展开后的过程（spec 4.11，3.1 起照 Tern）：一个工具一个块——头部一行（图标 + 工具名 + 目标 + 右侧数字，无底色无折叠箭头），
// 结果直接摆在下面：Read / Glob = 文件胶囊，Grep = 按文件分组的命中行，Bash = 卡片，Task / wait = 子代理小卡，
// Todo = 分组清单，Ask = 问题 + 全部选项，其余 = diff / 行号输出 / 纯文本（超过 12 行底部渐隐，可全部显示）。
// 叙述（· 开头单行）、思考照旧。>200 行只渲染最后 100 条。
import { createElement, memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronRight, CopyIcon, Dots, FileIcon, Pencil, Search, Terminal, Users } from "../../icons.tsx";
import { FileLink } from "../file-preview/index.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { BashCard, type BashState } from "./BashCard.tsx";
import { Clamp } from "./Clamp.tsx";
import { FileChip } from "./FileChip.tsx";
import type { Step, ToolStep } from "./model.ts";
import { summarizeTodos } from "./todo-model.ts";
import { toolTarget, toolVerb } from "./tool-info.ts";
import {
  askViews,
  bashStatus,
  bodyLineCount,
  buildBody,
  buildInfo,
  filePaths,
  formatElapsed,
  globPaths,
  headerTarget,
  toolDisplayName,
  todoPhases,
  waitJobs,
  type DiffRow,
  type GrepFile,
  type ToolBody,
  type ToolInfo,
} from "./tool-view.ts";
import { AskAnswers, TaskView, TodoView, WaitView, askTarget } from "./ToolViews.tsx";
import { useNow } from "./use-now.ts";

const PREVIEW_LINES = 12;
const GREP_LINES = 8;
const MANY = 200;
const KEEP = 100;
const NO_LANES: readonly SubagentLane[] = [];

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

function iconFor(name: string) {
  if (name === "task" || name === "wait") return Users;
  if (name === "ask") return Dots;
  if (name.includes("todo")) return Check;
  switch (toolVerb(name)) {
    case "read":
    case "write":
      return FileIcon;
    case "edit":
      return Pencil;
    case "bash":
      return Terminal;
    case "search":
      return Search;
    case "other":
      return ChevronRight;
  }
}

/** 图标组件是模块级常量，按工具名挑一个；用 createElement 免得在渲染里声明组件变量。 */
function ToolIcon({ name }: { name: string }) {
  return createElement(iconFor(name), { size: 14 });
}

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

/** Grep：每个文件一个文件胶囊（带命中数），下面是带行号的命中行（命中行左侧一条竖线）。 */
function GrepFiles({ files, taskId }: { files: readonly GrepFile[]; taskId: TaskId }) {
  return (
    <>
      {files.map((file, index) => (
        <div key={`${file.path}:${index}`} className="step-file">
          <div className="step-file-head">
            <FileChip taskId={taskId} path={file.path}>
              <span className="file-chip-count">{file.matches}</span>
            </FileChip>
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

function PlainLines({ lines }: { lines: readonly string[] }) {
  return (
    <div className="step-lines">
      {lines.map((line, index) => (
        <div key={index} className="step-ln">
          <span className="step-code">{line}</span>
        </div>
      ))}
    </div>
  );
}

/** 通用正文：diff / 行号输出 / 纯文本。bash 和 grep 有自己的块，不走这里。 */
function BodyView({ body, t }: { body: ToolBody; t: TFunction }) {
  switch (body.kind) {
    case "diff":
      return <DiffLines rows={body.rows} t={t} />;
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
    case "bash":
      return <PlainLines lines={body.lines} />;
    case "grep":
      return null;
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

/** 文件胶囊一排（Read / Glob）：一行的高度是 --row-tool，最多 3 行，超出渐隐。 */
function FileChips({ taskId, paths }: { taskId: TaskId; paths: readonly string[] }) {
  return (
    <Clamp lines={3} lineHeight="var(--row-tool)">
      <div className="file-chips">
        {paths.map((path) => (
          <FileChip key={path} taskId={taskId} path={path} />
        ))}
      </div>
    </Clamp>
  );
}

const ToolRow = memo(function ToolRow({
  step,
  taskId,
  projectPath,
  lanes,
}: {
  step: ToolStep;
  taskId: TaskId;
  projectPath: string | null;
  lanes: readonly SubagentLane[];
}) {
  const t = useT();
  const failed = step.status === "error";
  const running = step.status === "running";
  const now = useNow(running);
  const verb = toolVerb(step.name);
  const body = useMemo(
    () => buildBody(step.name, step.args, step.result, step.output),
    [step.name, step.args, step.result, step.output],
  );
  const paths = useMemo(() => filePaths(step.name, step.args), [step.name, step.args]);
  const found = useMemo(() => globPaths(step.name, step.output), [step.name, step.output]);
  const todos = step.name.includes("todo") ? todoPhases(step.result) : null;
  const asks = step.name === "ask" ? askViews(step.args, step.result) : [];
  const jobs = step.name === "wait" ? waitJobs(step.result) : [];
  const info = buildInfo(step.name, step.args, body);
  const total = bodyLineCount(body);
  const target = headerTarget(step.name, step.args);
  const duration = step.startedAt !== null && step.endedAt !== null ? step.endedAt - step.startedAt : 0;
  const elapsed = step.startedAt !== null ? now - step.startedAt : null;

  const bash = body.kind === "bash" && verb === "bash";
  // 文件胶囊：Read 总是胶囊；多文件的 edit / write 也列出来。Glob 的胶囊来自输出。
  const chipPaths = found.length > 0 ? found : verb === "read" || paths.length > 1 ? paths : [];
  const single = found.length === 0 && verb !== "read" && paths.length === 1 ? (paths[0] ?? null) : null;
  const range = (() => {
    const first = paths[0];
    return first !== undefined && target !== null && target.startsWith(first) ? target.slice(first.length) : "";
  })();

  // 头部目标
  let arg: ReactNode = null;
  if (todos !== null) {
    const { done, total: all } = summarizeTodos(todos);
    arg = `${done}/${all}`;
  } else if (asks.length > 0) {
    arg = askTarget(t, asks);
  } else if (single !== null) {
    arg = (
      <>
        <FileLink taskId={taskId} path={single} />
        {range !== "" && <span className="step-range">{range}</span>}
      </>
    );
  } else if (verb === "read" && paths.length > 0) {
    arg = paths.length > 1 ? t("tool.info.readFiles", { count: paths.length }) : range;
  } else if (paths.length > 1) {
    arg = t("tool.info.readFiles", { count: paths.length });
  } else if (info?.kind === "task") {
    // Task：`2 个代理  [后台]` 紧跟工具名，右侧只留耗时。
    arg = <InfoSegment info={info} />;
  } else if (!bash && step.name !== "wait") {
    arg = target;
  }

  // 右侧：数字（匹配数 / 文件数 / 行数 / 代理数）+ 耗时或运行中的实时秒数；bash 的状态在卡片脚里。
  const metaInfo: ReactNode =
    found.length > 0 ? (
      <span className="step-info">{t("tool.info.files", { count: found.length })}</span>
    ) : info !== null && info.kind !== "task" ? (
      <InfoSegment info={info} />
    ) : null;
  const time = failed ? (
    t("tool.failed")
  ) : running ? (
    <>
      <span className="step-spin" aria-hidden="true" />
      {elapsed !== null && formatElapsed(elapsed)}
    </>
  ) : duration >= 1000 ? (
    formatElapsed(duration)
  ) : null;

  const name =
    step.name === "wait" && jobs.length > 0 ? t("tool.wait.title", { count: jobs.length }) : toolDisplayName(step.name);

  let content: ReactNode = null;
  if (todos !== null) {
    content = <TodoView phases={todos} />;
  } else if (step.name === "ask") {
    content = <AskAnswers step={step} />;
  } else if (step.name === "task") {
    content = <TaskView step={step} taskId={taskId} projectPath={projectPath} lanes={lanes} />;
  } else if (jobs.length > 0) {
    content = <WaitView step={step} taskId={taskId} projectPath={projectPath} lanes={lanes} />;
  } else if (bash) {
    const status = bashStatus(step.result);
    const wall = step.startedAt !== null && step.endedAt !== null ? duration : status.wallMs;
    const state: BashState = running
      ? { kind: "running", elapsedMs: elapsed }
      : failed || (status.exitCode !== null && status.exitCode !== 0)
        ? {
            kind: "failed",
            label: status.exitCode !== null ? t("tool.bash.exit", { code: status.exitCode }) : t("tool.failed"),
            elapsedMs: wall,
          }
        : { kind: "done", elapsedMs: wall };
    content = (
      <BashCard
        command={body.kind === "bash" ? body.command : null}
        lines={body.kind === "bash" ? body.lines : []}
        state={state}
      />
    );
  } else {
    // Read 只列文件，内容不摆出来（失败时才显示错误文字）。
    const showBody = total > 0 && (verb !== "read" || failed);
    content = (
      <>
        {chipPaths.length > 0 && <FileChips taskId={taskId} paths={chipPaths} />}
        {showBody &&
          (body.kind === "grep" ? (
            <Clamp lines={GREP_LINES} lineHeight="var(--lh-code-sm)" className="step-grep">
              <GrepFiles files={body.files} taskId={taskId} />
            </Clamp>
          ) : (
            <div className="step-output">
              <Clamp lines={PREVIEW_LINES} lineHeight="var(--lh-code-sm)">
                <BodyView body={body} t={t} />
              </Clamp>
            </div>
          ))}
      </>
    );
  }

  return (
    <div className="step-tool" data-anchor data-status={step.status} data-tool={step.name}>
      <div className="step-head" title={toolLabel(step, t)}>
        <span className="step-icon">
          <ToolIcon name={step.name} />
        </span>
        <span className="step-name">{name}</span>
        {arg !== null && arg !== "" && <span className="step-arg">{arg}</span>}
        <span className="step-meta" data-failed={failed || undefined}>
          {metaInfo}
          {!bash && time}
        </span>
        <span className="step-actions">{total > 0 && <CopyButton text={bodyText(body)} />}</span>
      </div>
      {content}
    </div>
  );
});

/** 思考默认折叠成一行"思考"（同 omp 的 Thinking），点开才看全文；叙述行显示第一行，点开看全文。 */
function TextStepRow({ step }: { step: Extract<Step, { kind: "narration" | "thinking" }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const thinking = step.kind === "thinking";
  if (step.text.trim() === "") return null;
  return (
    <div className="step-text" data-anchor data-kind={step.kind}>
      <button type="button" className="step-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {thinking ? (
          <>
            <span className="step-icon">
              <ChevronRight size={12} className="step-chevron" data-open={open || undefined} />
            </span>
            <span className="step-label step-thinking">{t("process.thoughtShort")}</span>
          </>
        ) : (
          <>
            <span className="step-icon">·</span>
            <span className="step-label" data-muted>
              {step.text.split("\n")[0]}
            </span>
          </>
        )}
      </button>
      <Reveal open={open}>
        <div className="step-full">{thinking ? step.text.trim() : step.text}</div>
      </Reveal>
    </div>
  );
}

export function ProcessDetails({
  steps,
  taskId,
  projectPath = null,
  lanes = NO_LANES,
  header,
}: {
  steps: readonly Step[];
  taskId: TaskId;
  /** Task / wait 的子代理卡点开详情要用。 */
  projectPath?: string | null;
  /** 这一轮的子代理泳道（Task / wait 的卡片按它显示状态）。 */
  lanes?: readonly SubagentLane[];
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
          <ToolRow
            key={step.key}
            step={step}
            taskId={taskId}
            projectPath={projectPath}
            lanes={step.name === "task" || step.name === "wait" ? lanes : NO_LANES}
          />
        ) : (
          <TextStepRow key={step.key} step={step} />
        ),
      )}
    </div>
  );
}
