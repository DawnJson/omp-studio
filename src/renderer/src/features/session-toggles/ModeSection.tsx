// 模式开关（spec §4.14）：Plan / Vibe / Loop 的开关和输入，Prewalk 的停用。有模式时放在工具行模式胶囊的浮层里（只给当前模式的控件），
// 没有模式时放在"会话开关"菜单里（三种模式的开关 + Loop 的输入）。
// 开关只是把封闭的 TaskCommand（`/plan` `/plan-review` `/vibe` `/loop …`）交给主进程，由它发给 omp 并等 omp 的状态行变过去；
// 界面显示的永远是 TaskState.composerMode（omp 的状态行回读的结果），不在这里假设命令成功。
// 命令是切换：Plan 开着再发一次是"退出"（先到暂停，再发一次才关闭）、Loop 开着再发是"关闭"，所以每种状态只给对应的那个按钮。
import { useState } from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import { LOOP_LIMIT, parseTaskCommand, type TaskCommand } from "../../../../shared/omp-output/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Segmented, TextField } from "../../ui/controls.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { stopAndRestore } from "../composer/actions.ts";
import { loopConditionText, loopLimitText } from "./mode-format.ts";
import { ToggleRow } from "./ToggleRow.tsx";
import { runToggleCommand } from "./toggle-actions.ts";
import "./toggles.css";

type Condition = "none" | "until" | "while";

/** Loop 的输入：次数或时长、条件（命令成功时停 / 继续）、要重复的提示。 */
function LoopForm({ busy, onStart }: { busy: boolean; onStart(command: TaskCommand): void }) {
  const t = useT();
  const [limit, setLimit] = useState("");
  const [condition, setCondition] = useState<Condition>("none");
  const [command, setCommand] = useState("");
  const [prompt, setPrompt] = useState("");
  const trimmedLimit = limit.trim();
  const limitInvalid = trimmedLimit !== "" && !LOOP_LIMIT.test(trimmedLimit);
  const built: TaskCommand = {
    kind: "loopStart",
    ...(trimmedLimit !== "" && { limit: trimmedLimit }),
    ...(condition !== "none" && { condition: { until: condition === "until", command: command.trim() } }),
    ...(prompt.trim() !== "" && { prompt: prompt.trim() }),
  };
  // 同一套校验（主进程收到时也会跑一遍）：不合法的组合不给点"开始"。
  const valid = (() => {
    try {
      parseTaskCommand(built);
      return true;
    } catch {
      return false;
    }
  })();
  return (
    <div className="md-loop-form" data-testid="mode-loop-form">
      <label className="md-field">
        <span className="tg-label">{t("modes.loop.limit")}</span>
        <TextField
          size="sm"
          width="100%"
          mono
          value={limit}
          invalid={limitInvalid}
          placeholder={t("modes.loop.limitPlaceholder")}
          onChange={setLimit}
          testId="mode-loop-limit"
        />
      </label>
      <div className="md-field">
        <span id="md-loop-cond-label" className="tg-label">
          {t("modes.loop.condition")}
        </span>
        <Segmented<Condition>
          size="sm"
          value={condition}
          labelledBy="md-loop-cond-label"
          testId="mode-loop-condition"
          options={[
            { value: "none", label: t("modes.loop.condNone") },
            { value: "until", label: t("modes.loop.condUntil") },
            { value: "while", label: t("modes.loop.condWhile") },
          ]}
          onChange={setCondition}
        />
        {condition !== "none" && (
          <TextField
            size="sm"
            width="100%"
            mono
            value={command}
            placeholder={t("modes.loop.command")}
            onChange={setCommand}
            testId="mode-loop-command"
          />
        )}
      </div>
      <label className="md-field">
        <span className="tg-label">{t("modes.loop.prompt")}</span>
        <TextField
          size="sm"
          width="100%"
          value={prompt}
          placeholder={t("modes.loop.promptPlaceholder")}
          onChange={setPrompt}
          testId="mode-loop-prompt"
        />
      </label>
      {!valid && (limit !== "" || prompt !== "" || command !== "") && (
        <p className="tg-hint md-invalid" data-testid="mode-loop-invalid">
          {t("modes.loop.invalid")}
        </p>
      )}
      <div className="tg-actions">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !valid || (condition !== "none" && command.trim() === "")}
          testId="mode-loop-start"
          onClick={() => onStart(built)}
        >
          {t("modes.loop.start")}
        </Button>
      </div>
    </div>
  );
}

export function ModeSection({ taskId, task }: { taskId: TaskId; task: TaskState }) {
  const t = useT();
  const mode = task.composerMode;
  const goalOn = task.goal !== null;
  const [busy, setBusy] = useState<string | null>(null);

  // 同一时间只有一条命令在飞：omp 一条一条执行，连点会把状态搅在一起。
  const run = (key: string, job: () => Promise<unknown>) => {
    if (busy !== null) return;
    setBusy(key);
    job()
      .catch((error: unknown) => reportOmpError(t, error))
      .finally(() => setBusy(null));
  };
  const runCommand = (key: string, command: TaskCommand) =>
    run(key, () => window.studio.runTaskCommand(taskId, command));
  const disabled = busy !== null || goalOn;

  const planRow = (on: boolean) => (
    <ToggleRow
      id="plan"
      label={t("modes.plan")}
      hint={t("modes.plan.hint")}
      checked={on}
      session={false}
      differs={false}
      busy={disabled}
      onChange={() => runCommand("plan", { kind: "plan" })}
    />
  );
  const vibeRow = (on: boolean) => (
    <ToggleRow
      id="vibe"
      label={t("modes.vibe")}
      hint={t("modes.vibe.hint")}
      checked={on}
      session={false}
      differs={false}
      busy={disabled}
      onChange={() => runCommand("vibe", { kind: "vibe" })}
    />
  );

  let body;
  switch (mode?.kind) {
    case undefined:
      body = (
        <>
          {goalOn && (
            <p className="tg-note" data-testid="mode-blocked">
              {t("modes.blocked.goal")}
            </p>
          )}
          {planRow(false)}
          {vibeRow(false)}
          <div className="md-loop">
            <div className="tg-text">
              <span className="tg-label">{t("modes.loop")}</span>
              <span className="tg-hint">{t("modes.loop.hint")}</span>
            </div>
            <LoopForm busy={disabled} onStart={(command) => runCommand("loop", command)} />
          </div>
        </>
      );
      break;
    case "plan":
      body = mode.paused ? (
        <div className="md-block">
          <p className="tg-note" data-testid="mode-plan-paused">
            {t("modes.plan.paused")}
          </p>
          <div className="tg-actions">
            <Button
              size="sm"
              disabled={disabled}
              testId="mode-plan-disable"
              onClick={() => runCommand("plan", { kind: "plan" })}
            >
              {t("modes.plan.disable")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {planRow(true)}
          <div className="md-block tg-actions">
            <Button
              size="sm"
              disabled={disabled}
              testId="mode-plan-review"
              onClick={() => runCommand("planReview", { kind: "planReview" })}
            >
              {t("modes.plan.review")}
            </Button>
          </div>
        </>
      );
      break;
    case "vibe":
      body = vibeRow(true);
      break;
    case "prewalk":
      body = (
        <div className="md-block">
          <p className="tg-note" data-testid="mode-prewalk">
            {t("modes.prewalk.on")}
          </p>
          <div className="tg-actions">
            <Button
              size="sm"
              disabled={busy !== null}
              testId="mode-prewalk-off"
              onClick={() => run("prewalk", () => runToggleCommand(taskId, { kind: "prewalk", op: "off" }))}
            >
              {t("modes.prewalk.off")}
            </Button>
          </div>
        </div>
      );
      break;
    case "loop": {
      const details = [loopLimitText(t, mode), loopConditionText(t, mode)].filter((text) => text !== null);
      body = (
        <div className="md-block" data-testid="mode-loop-status" data-state={mode.state}>
          <p className="tg-label">{t("modes.loop")}</p>
          <p className="tg-note" data-testid="mode-loop-state">
            {t(`modes.loop.${mode.state}`)}
          </p>
          {details.length > 0 && (
            <p className="tg-hint" data-testid="mode-loop-details">
              {details.join(" · ")}
            </p>
          )}
          <div className="tg-actions">
            {mode.state === "running" && (
              <Button
                size="sm"
                disabled={busy !== null}
                testId="mode-loop-pause"
                onClick={() => run("pause", () => stopAndRestore(taskId, t))}
              >
                {t("modes.loop.pause")}
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy !== null}
              testId="mode-loop-stop"
              onClick={() => runCommand("loop", { kind: "loopStop" })}
            >
              {t("modes.loop.stop")}
            </Button>
          </div>
        </div>
      );
      break;
    }
  }
  return (
    <div
      className="md-section"
      role="group"
      aria-label={t("modes.title")}
      aria-busy={busy !== null}
      data-testid="mode-section"
    >
      {body}
    </div>
  );
}
