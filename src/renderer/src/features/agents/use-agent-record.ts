// 子代理的记录和最终输出：主进程只读 omp 存档（IPC getTspSubagentRecord）。名字或 `statusKey` 变了、手动刷新时重读；
// 运行中的子代理 `.md` 还没写，状态变成结束后再读一次就有了。过期的响应（切了子代理）丢弃。重读时保留上一份，不闪。
import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskId, TspSubagentRecord } from "../../../../shared/ipc.ts";
import { describeError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";

export interface AgentRecordState {
  record: TspSubagentRecord | null;
  loading: boolean;
  /** 调用失败（IPC 本身出错）的原因；文件缺失等走 `record.unavailable`。 */
  error: string | null;
  reload(): void;
}

/** 一次读取同时带回消息（记录）和最终输出；`statusKey` 变了（调用方放状态 + 工具调用数：每次工具调用、运行 → 结束）重读。 */
export function useAgentRecord(taskId: TaskId, name: string, statusKey: string): AgentRecordState {
  const t = useT();
  const [record, setRecord] = useState<TspSubagentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setLoading(true);
    window.studio.getTspSubagentRecord(taskId, name).then(
      (next) => {
        if (request !== latest.current) return;
        setRecord(next);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (request !== latest.current) return;
        setError(describeError(t, failure));
        setLoading(false);
      },
    );
    return () => {
      // 切子代理 / 卸载：让还在路上的响应过期。
      latest.current += 1;
    };
  }, [taskId, name, statusKey, nonce, t]);

  // 换了子代理：先清掉上一个的内容，别让它闪一下。
  useEffect(() => {
    setRecord(null);
    setError(null);
  }, [taskId, name]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { record, loading, error, reload };
}
