// 审批胶囊的数据：某个项目目录里 omp 实际生效的审批模式和来源（项目 .omp/config.yml 盖过全局，规则见主进程 omp-config/approval-mode.ts）。
// 全局快照（config-store.ts）里的 tools.approvalMode 变了（设置页、终端里改过后重读、本胶囊写入）也重读一次，两处显示一致。
import { useEffect, useState } from "react";
import type { ApprovalMode, ApprovalModeInfo, ProjectId } from "../../../../shared/ipc.ts";
import { saveOmpConfigOrThrow, useOmpConfigValue } from "../settings/config-store.ts";

const globalKey = "tools.approvalMode";

export interface ApprovalModeView {
  /** 还没读到这个项目的值（或读失败）时为 null。 */
  info: ApprovalModeInfo | null;
  /** 只写全局（`omp config set`）；项目配置覆盖时界面不调用它。 */
  set(mode: ApprovalMode): Promise<void>;
}

export function useApprovalMode(projectId: ProjectId | null): ApprovalModeView {
  const [loaded, setLoaded] = useState<{ projectId: ProjectId | null; info: ApprovalModeInfo } | null>(null);
  const globalValue = useOmpConfigValue(globalKey);

  useEffect(() => {
    let current = true;
    window.studio.getApprovalMode(projectId).then(
      (info) => {
        if (current) setLoaded({ projectId, info });
      },
      // 后台读失败不弹 toast（和 use-new-task-default 一样）：胶囊停在启动缓存的值上，点开改档位时的写入失败照常报错。
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [projectId, globalValue]);

  return {
    // 换了项目后旧项目的值不顶替：读到之前是 null。
    info: loaded !== null && loaded.projectId === projectId ? loaded.info : null,
    set: (mode) => saveOmpConfigOrThrow(globalKey, mode),
  };
}
