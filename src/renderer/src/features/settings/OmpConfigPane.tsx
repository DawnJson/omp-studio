// 设置页里 omp 自己的设置：一个 tab 或搜索结果。负责加载、出错、omp 没就绪、搜索没结果这几个状态。
import { describeError } from "../../ui/errors.ts";
import { useEffect, useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { Button } from "./controls.tsx";
import { ConfigResults, ConfigTab } from "./ConfigSection.tsx";
import { groupConfigItems, groupOf, type ConfigGroup } from "../../../../shared/ui/config-groups.ts";
import { matchesQuery } from "./config-meta.ts";
import { loadOmpConfig, useConfigLoad } from "./config-store.ts";

export function useOmpConfigLoader(): void {
  const status = useOmpStatus();
  const ready = status?.state === "ready";
  useEffect(() => {
    if (ready) void loadOmpConfig();
  }, [ready]);
  // 主进程启动时可能晚于设置页读快照才写入默认值：收到就静默重读，开关不停在旧值上。
  useEffect(() => window.studio.onOmpConfigChanged(() => void loadOmpConfig()), []);
}

/** `omit`：同一页别处已经有控件的键（"模型与账号"页上面的默认思考强度），这里不再重复一行；搜索不受影响。 */
export function OmpConfigPane({
  group,
  query,
  omit = [],
}: {
  group: ConfigGroup | null;
  query: string;
  omit?: readonly string[];
}) {
  const t = useT();
  const status = useOmpStatus();
  const load = useConfigLoad();
  const trimmed = query.trim();
  const snapshot = load.kind === "ready" ? load.snapshot : null;
  const results = useMemo(
    // 搜索只在会显示的项里找：终端专用的项（隐藏的）不出现。
    () =>
      snapshot && trimmed
        ? snapshot.items.filter((item) => groupOf(item.key) !== null && matchesQuery(item, trimmed))
        : [],
    [snapshot, trimmed],
  );

  if (status?.state !== "ready" && snapshot === null)
    return <p className="st-muted cfg-state">{t("settings.cfg.notReady")}</p>;
  if (load.kind === "error") {
    return (
      <div className="st-card st-block cfg-state" role="alert">
        <p className="st-error-text">{t("settings.cfg.failed", { message: describeError(t, load.error) })}</p>
        <Button onClick={() => void loadOmpConfig()}>{t("settings.cfg.retry")}</Button>
      </div>
    );
  }
  if (snapshot === null) {
    return (
      <p className="st-muted cfg-state cfg-loading" role="status">
        <span className="st-spinner cfg-spinner" aria-hidden="true" />
        {t("settings.cfg.loading")}
      </p>
    );
  }
  if (trimmed) {
    if (results.length === 0) {
      return (
        <div className="cfg-state" role="status">
          <p className="cfg-empty-title">{t("settings.search.empty", { query: trimmed })}</p>
          <p className="st-muted">{t("settings.search.emptyHint")}</p>
        </div>
      );
    }
    return <ConfigResults items={results} query={trimmed} />;
  }
  if (group === null) return null;
  const items = (groupConfigItems(snapshot.items).get(group) ?? []).filter((item) => !omit.includes(item.key));
  return <ConfigTab tab={group} items={items} />;
}
