// omp 设置的一个分组（omp-studio 自己的分组，见 config-groups.ts）或搜索结果：常用项在最前面，其余按 key 前缀折叠成小组，长列表不一次全展开。
import { useId, useState, type ReactNode } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { ChevronRight } from "../../icons.tsx";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { ConfigRow } from "./ConfigRow.tsx";
import { groupConfigItems } from "../../../../shared/ui/config-groups.ts";
import { groupItems, groupTitle } from "./config-meta.ts";

/** 超过这个数量的分组，非"常用"的小组默认折叠。 */
const collapseThreshold = 30;

// 折叠状态记在模块里：切换分组再回来保持原样。
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
      {open && (
        <div id={bodyId} className="st-card cfg-card">
          {children}
        </div>
      )}
    </section>
  );
}

/** 一个分组的全部设置。 */
export function ConfigTab({ tab, items }: { tab: string; items: readonly OmpConfigItem[] }) {
  const t = useT();
  const [, rerender] = useState(0);
  const groups = groupItems(items);
  const many = items.length > collapseThreshold;
  return (
    <>
      {groups.map((group, index) => {
        const key = `${tab}|${group.id}`;
        const open = openState.get(key) ?? (group.prefix === null || !many || (index === 0 && groups.length === 1));
        const title =
          group.prefix === null
            ? t("settings.cfg.common")
            : group.prefix === ""
              ? t("settings.cfg.other")
              : group.prefix.charAt(0).toUpperCase() + group.prefix.slice(1);
        const body = (
          <>
            {group.items.map((item) => (
              <ConfigRow key={item.key} item={item} />
            ))}
          </>
        );
        if (groups.length === 1)
          return (
            <div key={key} className="st-card cfg-card">
              {body}
            </div>
          );
        return (
          <Disclosure
            key={key}
            id={group.id}
            title={title}
            count={group.items.length}
            open={open}
            onToggle={() => {
              openState.set(key, !open);
              rerender((n) => n + 1);
            }}
          >
            {body}
          </Disclosure>
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
