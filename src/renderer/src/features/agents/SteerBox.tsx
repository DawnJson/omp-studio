// 面板底部的插话框（钉在面板底边，不随详情滚动）：一个多行输入 + 右下角的发送键。
// Enter 发送（Shift+Enter 换行、输入法组字时不发）。发送期间面板顶部显示"正在发给 <名字>"（主进程在后台走 Hub，要一两秒），
// 成功后清空，失败（omp 的原文已经 toast）文字留着。
import { useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { subagentLimits } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { ArrowUp } from "../../icons.tsx";
import { Button, Textarea } from "../../ui/controls.tsx";
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
      <Textarea
        testId="agents-steer-input"
        rows={2}
        value={text}
        maxLength={subagentLimits.steerChars}
        placeholder={t("agents.steerPlaceholder", { name })}
        aria-label={t("agents.steerLabel", { name })}
        disabled={busy}
        onChange={setText}
        onKeyDown={onKeyDown}
      />
      <Button
        variant="primary"
        size="sm"
        icon={<ArrowUp size={14} />}
        testId="agents-steer-send"
        title={t("agents.steerSend")}
        disabled={busy || message === ""}
        onClick={send}
      >
        {t("agents.steerSend")}
      </Button>
    </div>
  );
}
