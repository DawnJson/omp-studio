// 面板底部的插话框：Enter 发送（Shift+Enter 换行、输入法组字时不发）。发送期间显示"正在发给 <名字>"（主进程在后台走 Hub，要一两秒），
// 成功后清空，失败（omp 的原文已经 toast）文字留着。
import { useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { subagentLimits } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { steerAgent } from "./agents-actions.ts";

export function SteerBox({ taskId, name, busy }: { taskId: TaskId; name: string; busy: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const message = text.trim();
  const send = () => {
    if (message === "" || busy) return;
    void steerAgent(t, taskId, name, message).then((sent) => {
      if (sent) setText("");
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="agents-steer" data-testid="agents-steer">
      <textarea
        className="agents-steer-input"
        data-testid="agents-steer-input"
        rows={2}
        value={text}
        maxLength={subagentLimits.steerChars}
        placeholder={t("agents.steerPlaceholder")}
        aria-label={t("agents.steerLabel", { name })}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="lane-btn"
        data-testid="agents-steer-send"
        disabled={busy || message === ""}
        onClick={send}
      >
        {t("agents.steerSend")}
      </button>
    </div>
  );
}
