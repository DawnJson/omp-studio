// omp 设置的展示：各节页面上的常用项（一张卡）、"高级"（全部非常用项）、搜索结果。
// 高级：按 omp-studio 的分组（config-groups.ts）一个小标题，组内按 key 前缀折叠成小组，默认全部收起。
import { useId, useState, type ReactNode } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { ChevronRight } from "../../icons.tsx";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { ConfigRow } from "./ConfigRow.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { groupConfigItems } from "../../../../shared/ui/config-groups.ts";
import { prefixTitle } from "../../../../shared/ui/config-labels.ts";
import { groupTitle, prefixGroups } from "./config-meta.ts";

// 折叠状态记在模块里：换节再回来保持原样。
const openState = new Map<string, boolean>();

function Disclosure({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const t = useT();
  const bodyId = useId();
  return (
    <section className="cfg-group" data-testid={`cfg-group-${id}`}>
      <button
        type="button"
        className="cfg-group-head"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={`${open ? t("settings.cfg.collapseGroup", { group: title }) : t("settings.cfg.expandGroup", { group: title })}`}
        onClick={onToggle}
      >
        <ChevronRight size={14} className="icon cfg-chevron" data-open={open || undefined} />
        <span className="cfg-group-title">{title}</span>
        <span className="cfg-group-count">{count}</span>
      </button>
      <Reveal open={open} id={bodyId}>
        <div className="st-card cfg-card">{children}</div>
      </Reveal>
    </section>
  );
}

/** 一节页面上的常用项：一张卡，不折叠。 */
export function ConfigCard({ items }: { items: readonly OmpConfigItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="st-card cfg-card">
      {items.map((item) => (
        <ConfigRow key={item.key} item={item} />
      ))}
    </div>
  );
}

/** 高级：每个分组一个小标题（带项数），下面是按前缀折叠的小组，默认收起。 */
export function AdvancedConfig({ items }: { items: readonly OmpConfigItem[] }) {
  const t = useT();
  const locale = useLocale();
  const [, rerender] = useState(0);
  return (
    <>
      {[...groupConfigItems(items)].map(([group, inGroup]) => {
        const groups = prefixGroups(inGroup);
        if (groups.length === 0) return null;
        const count = groups.reduce((sum, { items: bucket }) => sum + bucket.length, 0);
        return (
          <section key={group} data-testid={`cfg-advanced-${group}`}>
            <h3 className="settings-group-title cfg-advanced-title">
              {groupTitle(locale, group)} <span className="cfg-group-count">{count}</span>
            </h3>
            {groups.map(({ prefix, items: bucket }) => {
              const key = `${group}|${prefix}`;
              const open = openState.get(key) ?? false;
              return (
                <Disclosure
                  key={key}
                  id={`${group}-${prefix || "other"}`}
                  title={prefix === "" ? t("settings.cfg.other") : prefixTitle(locale, prefix)}
                  count={bucket.length}
                  open={open}
                  onToggle={() => {
                    openState.set(key, !open);
                    rerender((n) => n + 1);
                  }}
                >
                  {bucket.map((item) => (
                    <ConfigRow key={item.key} item={item} />
                  ))}
                </Disclosure>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

/** 搜索结果：按 omp-studio 的分组分节，全部展开（匹配的项数通常不多）。 */
export function ConfigResults({ items, query }: { items: readonly OmpConfigItem[]; query: string }) {
  const locale = useLocale();
  return (
    <>
      {[...groupConfigItems(items)].map(([group, inGroup]) => (
        <section key={group} className="cfg-group" data-testid={`cfg-result-${group}`}>
          <h3 className="settings-group-title cfg-result-title">
            {groupTitle(locale, group)} <span className="cfg-group-count">{inGroup.length}</span>
          </h3>
          <div className="st-card cfg-card">
            {inGroup.map((item) => (
              <ConfigRow key={item.key} item={item} query={query} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
