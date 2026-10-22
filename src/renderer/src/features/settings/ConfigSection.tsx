// omp 设置的展示：各节页面上的常用项（一组行）、"高级"（页内目录 + 选中分组的全部行平铺）、搜索结果。
// 高级：左侧目录 = omp-studio 的 8 个分组 + 当前分组下的前缀小组（带个数）；右侧是选中分组的行，没有折叠，前缀做小标题。
import { useMemo, useState } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { SectionHead } from "../../ui/controls.tsx";
import { groupConfigItems } from "../../../../shared/ui/config-groups.ts";
import { prefixTitle } from "../../../../shared/ui/config-labels.ts";
import { ConfigRow } from "./ConfigRow.tsx";
import { advancedGroups, groupTitle } from "./config-meta.ts";

/** 一节页面上的常用项：一组行，不折叠。 */
export function ConfigCard({ items }: { items: readonly OmpConfigItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="ui-rows st-rows">
      {items.map((item) => (
        <ConfigRow key={item.key} item={item} />
      ))}
    </div>
  );
}

// 目录选中的分组和小组记在模块里：换节再回来保持原样。
const picked: { group: string | null; prefix: string | null } = { group: null, prefix: null };

const anchorId = (group: string, prefix: string) => `cfg-sub-${group}-${prefix === "" ? "other" : prefix}`;

/** 高级：左侧目录 + 选中分组的全部行（按前缀小标题分段）。 */
export function AdvancedConfig({ items }: { items: readonly OmpConfigItem[] }) {
  const t = useT();
  const locale = useLocale();
  const groups = useMemo(() => advancedGroups(items), [items]);
  const [, rerender] = useState(0);
  const current = groups.find((group) => group.group === picked.group) ?? groups[0];
  if (current === undefined) return null;
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const activePrefix = picked.prefix ?? current.prefixes[0]?.prefix ?? "";

  return (
    <>
      <p className="ui-section-note st-adv-note">{t("settings.advanced.note", { count: total })}</p>
      <div className="st-adv">
        <nav className="st-toc" aria-label={t("settings.advanced.toc")} data-testid="advanced-toc">
          {groups.map((group) => {
            const open = group.group === current.group;
            return (
              <div key={group.group} className="st-toc-block">
                <button
                  type="button"
                  className="st-toc-group"
                  aria-current={open ? "true" : undefined}
                  onClick={(event) => {
                    picked.group = group.group;
                    picked.prefix = null;
                    rerender((n) => n + 1);
                    event.currentTarget.closest(".settings-scroll")?.scrollTo({ top: 0 });
                  }}
                  data-testid={`advanced-toc-${group.group}`}
                >
                  {groupTitle(locale, group.group)}
                  <span className="ui-count">{group.count}</span>
                </button>
                {open &&
                  group.prefixes.map(({ prefix, items: bucket }) => (
                    <button
                      key={prefix}
                      type="button"
                      className="st-toc-item"
                      aria-current={prefix === activePrefix ? "true" : undefined}
                      onClick={() => {
                        picked.prefix = prefix;
                        rerender((n) => n + 1);
                        document.getElementById(anchorId(group.group, prefix))?.scrollIntoView({ block: "start" });
                      }}
                      data-testid={`advanced-toc-${group.group}-${prefix || "other"}`}
                    >
                      {prefix === "" ? t("settings.cfg.other") : prefixTitle(locale, prefix)}
                      <span className="ui-count">{bucket.length}</span>
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>
        <div className="st-adv-rows" data-testid={`cfg-advanced-${current.group}`}>
          {current.prefixes.map(({ prefix, items: bucket, modified }) => (
            <section
              key={prefix}
              id={anchorId(current.group, prefix)}
              className="st-adv-sub"
              data-testid={`cfg-group-${current.group}-${prefix || "other"}`}
            >
              <SectionHead
                title={
                  <>
                    {prefix === "" ? t("settings.cfg.other") : prefixTitle(locale, prefix)}
                    {prefix !== "" && <span className="st-prefix-key">{prefix}.*</span>}
                  </>
                }
                count={
                  t("settings.cfg.itemCount", { count: bucket.length }) +
                  (modified > 0 ? ` · ${t("settings.cfg.modifiedCount", { count: modified })}` : "")
                }
              />
              <div className="ui-rows st-rows">
                {bucket.map((item) => (
                  <ConfigRow key={item.key} item={item} keyPrefix={prefix} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

/** 搜索结果：按 omp-studio 的分组分段，全部展开（匹配的项数通常不多）。 */
export function ConfigResults({ items, query }: { items: readonly OmpConfigItem[]; query: string }) {
  const locale = useLocale();
  return (
    <>
      {[...groupConfigItems(items)].map(([group, inGroup]) => (
        <section key={group} className="st-section" data-testid={`cfg-result-${group}`}>
          <SectionHead title={groupTitle(locale, group)} count={inGroup.length} />
          <div className="ui-rows st-rows">
            {inGroup.map((item) => (
              <ConfigRow key={item.key} item={item} query={query} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
