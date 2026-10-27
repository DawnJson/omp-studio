// 设置页按钮的一次异步动作：跑的时候 busy（按钮禁用 / 转圈），job 抛错交给 onError（各处的报错方式不同：卡片里的失败行、toast、对话框里的错误）。
import { useState } from "react";

export function useAsyncAction(onError: (error: unknown) => void): {
  busy: boolean;
  /** 跑 job；正常结束返回 true，抛错（已交给 onError）返回 false。 */
  run: (job: () => Promise<unknown>) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await job();
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
