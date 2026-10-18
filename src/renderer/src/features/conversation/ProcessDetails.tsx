// 展开后的过程（spec 4.11）：工具行（点一下就地展开输出，最多 12 行）、叙述（· 开头单行）、思考。>200 行只渲染最后 100 条。
import { useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight, FileIcon, Pencil, Search, Terminal } from "../../icons.tsx";
import { formatDuration } from "./format.ts";
import type { Step, ToolStep } from "./model.ts";
import { toolTarget, toolVerb } from "./tool-info.ts";

const OUTPUT_LINES = 12;
const FAILED_PREVIEW_LINES = 4;
const MANY = 200;
const KEEP = 100;

export function toolLabel(step: ToolStep, t: TFunction): string {
  if (step.intent) return step.intent;
  const target = toolTarget(step.args) ?? "";
  switch (toolVerb(step.name)) {
    case "read": return t("tool.verb.read", { target });
    case "edit": return t("tool.verb.edit", { target });
    case "write": return t("tool.verb.write", { target });
    case "bash": return t("tool.verb.bash", { target });
    case "search": return t("tool.verb.search", { target });
    default: return t("tool.verb.other", { tool: step.name });
  }
}

const verbIcon = { read: FileIcon, write: FileIcon, edit: Pencil, bash: Terminal, search: Search, other: ChevronRight } as const;

function ToolRow({ step }: { step: ToolStep }) {
  const t = useT();
  const failed = step.status === "error";
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const Icon = verbIcon[toolVerb(step.name)];
  const outputLines = (step.output ?? "").replace(/\n$/, "").split("\n");
  const limit = failed && !open ? FAILED_PREVIEW_LINES : OUTPUT_LINES;
  const showOutput = open || failed;
  const duration = step.startedAt !== null && step.endedAt !== null ? step.endedAt - step.startedAt : 0;
  const target = toolTarget(step.args);
  return (
    <div className="step-tool" data-anchor data-status={step.status}>
      <button type="button" className="step-row" aria-expanded={showOutput} onClick={() => setOpen((value) => !value)}>
        <span className="step-icon"><Icon size={14} /></span>
        <span className="step-label">{toolLabel(step, t)}</span>
        {target !== null && step.intent !== null && <span className="step-arg">{target}</span>}
        <span className="step-meta" data-failed={failed || undefined}>
          {failed ? t("tool.failed") : step.status === "running" ? t("tool.running") : duration >= 1000 ? formatDuration(t, duration) : ""}
        </span>
      </button>
      {showOutput && (
        <pre className="step-output">
          {step.output === null || step.output === "" ? t("tool.output.empty") : (all ? outputLines : outputLines.slice(0, limit)).join("\n")}
          {!all && outputLines.length > limit && (
            <button type="button" className="step-showall" onClick={() => setAll(true)}>
              {t("tool.output.showAll")}
            </button>
          )}
        </pre>
      )}
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
        <span className="step-label" data-muted>{thinking ? `${t("process.thoughtShort")} · ${step.text.trim().split("\n")[0]}` : step.text.split("\n")[0]}</span>
      </button>
      {open && <div className="step-full">{step.text}</div>}
    </div>
  );
}

export function ProcessDetails({ steps }: { steps: readonly Step[] }) {
  const t = useT();
  const trimmed = steps.length > MANY ? steps.slice(-KEEP) : steps;
  return (
    <div className="details">
      {steps.length > trimmed.length && <p className="details-earlier">{t("process.earlier", { n: steps.length - trimmed.length })}</p>}
      {trimmed.map((step) => (step.kind === "tool" ? <ToolRow key={step.key} step={step} /> : <TextStepRow key={step.key} step={step} />))}
    </div>
  );
}
