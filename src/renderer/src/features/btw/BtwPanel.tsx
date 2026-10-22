// 旁路提问面板（/btw）：停在输入框上方，回答流式显示在这里，不进主对话流。主轮在跑时也能问（实测）；
// omp 同一时刻只许一条旁路提问在跑，所以提问中输入框换成"取消提问"。Esc：提问中取消，否则关闭面板。
// 记录在 store/btw-store.ts（主进程事件的投影），界面状态在 btw-ui-store.ts。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { btwTurns, isBtwRunning, latestTurn, type BtwHistoryTurn } from "../../../../shared/btw.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Plus } from "../../icons.tsx";
import { Markdown } from "../../markdown/index.ts";
import { useBtwRecords } from "../../store/index.ts";
import { Badge, Button, IconButton, Tabs, TextField } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { askBtwQuestion, cancelBtwQuestion } from "./btw-actions.ts";
import { closeBtw, selectBtwTopic, useBtwUi } from "./btw-ui-store.ts";
import { activeTopic, canAsk, NEW_TOPIC, topicLabel } from "./btw-view.ts";
import "./btw.css";

const STICK_SLACK_PX = 24;

function TurnView({ turn }: { turn: BtwHistoryTurn }) {
  const t = useT();
  const running = turn.status === "running";
  const note = turn.status === "complete" || running ? null : t(`btw.status.${turn.status}`);
  return (
    <div className="btw-turn" data-testid="btw-turn" data-status={turn.status}>
      <p className="btw-q">{turn.question}</p>
      {turn.answer !== "" && <Markdown source={turn.answer} streaming={running} />}
      {running && turn.answer === "" && <p className="btw-note">{t("btw.status.running")}</p>}
      {note !== null && (
        <p className="btw-note" data-status={turn.status} title={turn.error}>
          {note}
        </p>
      )}
    </div>
  );
}

function BtwPanelBody({ taskId, open }: { taskId: TaskId; open: boolean }) {
  const t = useT();
  const ui = useBtwUi(taskId);
  const records = useBtwRecords(taskId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  const topic = activeTopic(records, ui.selection);
  const running = isBtwRunning(records);
  const latest = topic === null ? null : latestTurn(topic);
  const lastAnswer = latest?.answer.length ?? 0;

  // 打开时记下焦点原来在哪，关闭时还回去（输入框里按 Esc 之后继续打字不用再点一下）。
  // 按 open 而不是按卸载：收起动画期间焦点就该回去了。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [ui.focusNonce]);

  // 流式时粘底；用户往上翻了就不拽回来。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && stuck.current) body.scrollTop = body.scrollHeight;
  }, [topic?.id, topic?.followUps?.length, lastAnswer]);

  const ask = () => {
    const question = text.trim();
    if (!canAsk(records, question) || sending) return;
    setSending(true);
    askBtwQuestion(taskId, question, topic?.id).then(
      () => {
        setText("");
        setSending(false);
        stuck.current = true;
      },
      (error: unknown) => {
        setSending(false);
        reportError(t, error, t("btw.askFailed"));
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (running) void cancelBtwQuestion(taskId, t);
    else closeBtw(taskId);
  };

  return (
    <section className="btw" aria-label={t("btw.title")} data-testid="btw-panel" onKeyDown={onKeyDown}>
      <header className="btw-head">
        <span className="btw-title">{t("btw.title")}</span>
        {running && (
          <Badge tone="accent" dot testId="btw-running">
            {t("btw.status.running")}
          </Badge>
        )}
        <span className="btw-spacer" />
        {topic !== null && (
          <IconButton
            label={t("btw.newTopic")}
            testId="btw-new-topic"
            onClick={() => {
              selectBtwTopic(taskId, NEW_TOPIC);
              inputRef.current?.focus();
            }}
          >
            <Plus size={14} />
          </IconButton>
        )}
        <IconButton label={t("btw.close")} testId="btw-close" onClick={() => closeBtw(taskId)}>
          <Close size={14} />
        </IconButton>
      </header>
      {records.length > 1 && (
        <div className="btw-topics">
          <Tabs
            label={t("btw.topics")}
            idBase={`btw-${taskId}`}
            testId="btw-topics"
            value={topic?.id ?? ""}
            tabs={records.map((record) => ({ id: record.id, label: topicLabel(record), title: record.question }))}
            onChange={(id) => selectBtwTopic(taskId, id)}
          />
        </div>
      )}
      {topic !== null && (
        <div
          className="btw-body"
          ref={bodyRef}
          data-testid="btw-body"
          onScroll={(event) => {
            const body = event.currentTarget;
            stuck.current = body.scrollHeight - body.scrollTop - body.clientHeight < STICK_SLACK_PX;
          }}
        >
          {btwTurns(topic).map((turn, index) => (
            <TurnView key={`${topic.id}:${index}`} turn={turn} />
          ))}
        </div>
      )}
      <form
        className="btw-ask"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <TextField
          ref={inputRef}
          size="sm"
          width="100%"
          className="btw-input"
          testId="btw-input"
          value={text}
          placeholder={topic === null ? t("btw.placeholder") : t("btw.placeholderFollowUp")}
          aria-label={t("btw.title")}
          onChange={setText}
          onKeyDown={(event) => {
            // 输入法选词的回车不是提交；Esc 交给 section 的处理。
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
        {running ? (
          <Button size="sm" variant="danger" testId="btw-cancel" onClick={() => void cancelBtwQuestion(taskId, t)}>
            {t("btw.cancel")}
          </Button>
        ) : (
          <Button size="sm" testId="btw-send" disabled={sending || !canAsk(records, text)} onClick={ask}>
            {t("btw.send")}
          </Button>
        )}
      </form>
    </section>
  );
}

/** 面板开着才挂载内容：打开时抓住原焦点；关闭（open 变 false）时立刻还回去，收起动画照常放完再卸载。 */
export function BtwPanel({ taskId }: { taskId: TaskId }) {
  const ui = useBtwUi(taskId);
  return (
    <Reveal open={ui.open} className="btw-reveal">
      <BtwPanelBody key={taskId} taskId={taskId} open={ui.open} />
    </Reveal>
  );
}
