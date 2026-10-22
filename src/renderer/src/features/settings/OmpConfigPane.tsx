// 设置页里 omp 自己的设置：一节的常用项、"高级"或搜索结果。负责加载、出错、omp 没就绪、搜索没结果这几个状态。
import { describeError } from "../../ui/errors.ts";
import { useEffect, useMemo } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { Button } from "./controls.tsx";
import { AdvancedConfig, ConfigCard, ConfigResults } from "./ConfigSection.tsx";
import { groupConfigItems, groupOf, type ConfigGroup } from "../../../../shared/ui/config-groups.ts";
import { commonItems, matchesQuery } from "./config-meta.ts";
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

const noOmit: readonly string[] = [];

/**
 * 一个分组的常用项（有人话标签的），还没读到时为空。给把 omp 的几行并进自己卡片的页面用（通用、模型）。
 * `omit`：页面上别处已经有控件的键，模块级常量（参与 useMemo）。
 */
export function useCommonConfigItems(group: ConfigGroup, omit: readonly string[] = noOmit): OmpConfigItem[] {
  const load = useConfigLoad();
  return useMemo(
    () =>
      load.kind === "ready"
        ? commonItems(groupConfigItems(load.snapshot.items).get(group) ?? []).filter((item) => !omit.includes(item.key))
        : [],
    [load, group, omit],
  );
}

export type ConfigView =
  { kind: "common"; group: ConfigGroup } | { kind: "advanced" } | { kind: "search"; query: string };

export function OmpConfigPane({ view }: { view: ConfigView }) {
  const t = useT();
  const status = useOmpStatus();
  const load = useConfigLoad();
  const query = view.kind === "search" ? view.query.trim() : "";
  const snapshot = load.kind === "ready" ? load.snapshot : null;
  const results = useMemo(
    // 搜索只在会显示的项里找：终端专用的项（隐藏的）不出现。
    () =>
      snapshot && query ? snapshot.items.filter((item) => groupOf(item.key) !== null && matchesQuery(item, query)) : [],
    [snapshot, query],
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
  switch (view.kind) {
    case "search":
      if (results.length === 0) {
        return (
          <div className="cfg-state" role="status">
            <p className="cfg-empty-title">{t("settings.search.empty", { query })}</p>
            <p className="st-muted">{t("settings.search.emptyHint")}</p>
          </div>
        );
      }
      return <ConfigResults items={results} query={query} />;
    case "advanced":
      return <AdvancedConfig items={snapshot.items} />;
    case "common":
      return <ConfigCard items={commonItems(groupConfigItems(snapshot.items).get(view.group) ?? [])} />;
  }
}
