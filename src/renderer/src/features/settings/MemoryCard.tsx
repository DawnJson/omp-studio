// 设置 → 上下文与记忆 → 记忆（spec §4.19）：`/memory` 的界面。
// 记忆是按项目分的（实测 18.12.5：sharpshooter 后端的 bank 来自工作目录，`proj-dir-<hash>`；local 后端是项目级的摘要；omp 的 memory.md 同），
// 所以每次操作都在所选项目的目录里跑（短命 rpc-ui）。没有项目时没有可操作的对象。
// 输出是 omp 的原文（stats、diagnose 是 markdown，queue / view 是文本），放在等宽的 `<pre>` 里，不当 HTML 渲染。
// 后端（memory.backend）是同一页上面的常用设置项，这里不再重复显示。
import { useEffect, useId, useState } from "react";
import { MEMORY_OPS } from "../../../../shared/omp-output/index.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus, useSelectedTaskId, useTask } from "../../store/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { useProjects } from "../sidebar/projects-store.ts";
import { Button, Card, SettingRow, Segmented, type Option } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { runBuiltinText } from "./integrations-data.ts";
import { setCardScope, useCardScope, type ScopeKey } from "./integrations-store.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import "./integrations.css";

type ReadOp = "stats" | "diagnose" | "queue" | "view";
// MEMORY_OPS 是 S0 定的封闭集合；这里只用其中的子集，编译期确认它们都在里面。
const READ_OPS = ["stats", "diagnose", "queue", "view"] as const satisfies readonly (typeof MEMORY_OPS)[number][];

export function MemoryCard() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const projects = useProjects();
  const selected = useCardScope("memory");
  const taskProject = useTask(useSelectedTaskId())?.projectId ?? null;
  const readId = useId();
  const [readOp, setReadOp] = useState<ReadOp>("stats");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // 默认选当前任务所在的项目，其次第一个项目；选中的项目被移除了就换掉。
  const known = (id: string | null): id is ScopeKey => id !== null && projects.some((project) => project.id === id);
  const scope: ScopeKey | null = known(selected)
    ? selected
    : known(taskProject)
      ? taskProject
      : (projects[0]?.id ?? null);

  const run = async (op: ReadOp | "clear"): Promise<boolean> => {
    if (scope === null) return false;
    setBusy(true);
    setError(null);
    try {
      const output = await runBuiltinText({ kind: "memory", op }, scope);
      setText(output.trim());
      return true;
    } catch (caught) {
      setError(errorDetail(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // 换项目或换查看项时重读（动作的结果留在原处，直到换了查看项）。
  useEffect(() => {
    if (ready && scope !== null) void run(readOp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, scope, readOp]);

  const readOptions: Option<ReadOp>[] = READ_OPS.map((op) => ({ value: op, label: t(`integrations.memory.op.${op}`) }));

  return (
    <>
      <h3 className="settings-group-title">{t("integrations.memory.title")}</h3>
      <Card testId="memory-card">
        {projects.length === 0 ? (
          <div className="st-block st-muted" data-testid="memory-no-project">
            {t("integrations.memory.noProject")}
          </div>
        ) : (
          <>
            <SettingRow title={t("integrations.memory.project")} desc={t("integrations.memory.project.desc")}>
              {(labelId) =>
                scope !== null && (
                  <ScopePicker
                    value={scope}
                    includeUser={false}
                    labelledBy={labelId}
                    onChange={(next) => setCardScope("memory", next)}
                    testId="memory-project-picker"
                  />
                )
              }
            </SettingRow>
            <div className="st-block ig-memory-tabs">
              <span id={readId} className="st-row-title">
                {t("integrations.memory.view")}
              </span>
              <Segmented<ReadOp>
                value={readOp}
                options={readOptions}
                labelledBy={readId}
                onChange={setReadOp}
                testId="memory-op"
              />
            </div>
            <div className="st-block">
              {error !== null ? (
                <div className="st-error-text ig-raw" role="alert" data-testid="memory-error">
                  {error}
                </div>
              ) : (
                <pre className="ig-pre" data-testid="memory-output" aria-busy={busy}>
                  {text === null
                    ? t("integrations.loading")
                    : text === ""
                      ? t("integrations.memory.emptyOutput")
                      : text}
                </pre>
              )}
            </div>
            <div className="st-block ig-footer">
              <Button
                variant="danger"
                disabled={!ready || busy}
                onClick={() => setConfirmClear(true)}
                testId="memory-clear"
              >
                {t("integrations.memory.clear")}
              </Button>
              <Button variant="text" disabled={!ready || busy} onClick={() => void run(readOp)} testId="memory-refresh">
                {t("integrations.refresh")}
              </Button>
            </div>
          </>
        )}
        <div className="st-block st-muted">{t("integrations.memory.note")}</div>
      </Card>
      {confirmClear && (
        <ConfirmDialog
          title={t("integrations.memory.clear.title")}
          body={t("integrations.memory.clear.body")}
          confirmLabel={t("integrations.memory.clear")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setConfirmClear(false);
            void run("clear").then((ok) => ok && pushToast({ message: t("integrations.memory.cleared") }));
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  );
}
