// omp 设置的展示：各节页面上的常用项（小标题 + 格子）、"高级"（页内目录 + 选中分组的全部项平铺）、搜索结果（一列行）。
// 高级：左侧目录 = omp-studio 的 8 个分组（带个数）+ 当前分组下的前缀小组；右侧是选中分组的项，没有折叠，前缀做小标题。
import { Fragment, useMemo, type ReactNode } from "react";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { SectionHead } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { groupConfigItems } from "../../../../shared/ui/config-groups.ts";
import { prefixTitle } from "../../../../shared/ui/config-labels.ts";
import { fitsCell } from "./ConfigControls.tsx";
import { ConfigRow } from "./ConfigRow.tsx";
import { advancedGroups, commonBlocks, groupTitle, type CommonBlockId } from "./config-meta.ts";

/**
 * 一组设置的排法（spec §4.19 格子排法）：按顺序逐行填进格子，列数随宽度（settings.css 的 .st-cells）。
 * 各节页面上：控件窄的进格子，文本框、标签输入、JSON 整行排在后面；`allCells`（高级页）：全部进格子，保持 omp 的顺序。
 */
function ConfigGrid({
  items,
  keyPrefix = "",
  allCells = false,
}: {
  items: readonly OmpConfigItem[];
  keyPrefix?: string;
  allCells?: boolean;
}) {
  const cells = allCells ? items : items.filter(fitsCell);
  const rows = allCells ? [] : items.filter((item) => !fitsCell(item));
  return (
    <>
      {cells.length > 0 && (
        <div className="st-cells">
          {cells.map((item) => (
            <ConfigRow key={item.key} item={item} keyPrefix={keyPrefix} />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="st-rows">
          {rows.map((item) => (
            <ConfigRow key={item.key} item={item} keyPrefix={keyPrefix} />
          ))}
        </div>
      )}
    </>
  );
}

/** 页面标题已经说明的小块不再写小标题（Subagent 页只有这一块，目标块只有一行）。 */
function hasBlockTitle(id: CommonBlockId): id is Exclude<CommonBlockId, "subagents" | "goal"> {
  return id !== "subagents" && id !== "goal";
}

const noLeads: Partial<Record<CommonBlockId, ReactNode>> = {};

/**
 * 一节页面上的常用项：按小块排（config-meta 的 commonBlocks），每块一个小标题 + ConfigGrid。
 * `leads`：页面自己的内容，整宽放在那一块的最前面（模型页的角色表）；常用项还没读到时也显示。
 */
export function CommonConfig({
  items,
  leads = noLeads,
}: {
  items: readonly OmpConfigItem[];
  leads?: Partial<Record<CommonBlockId, ReactNode>>;
}) {
  const t = useT();
  return commonBlocks(items, Object.keys(leads) as CommonBlockId[]).map((block) => (
    <Fragment key={block.id}>
      {block.id !== "" && hasBlockTitle(block.id) && <SectionHead title={t(`settings.block.${block.id}`)} />}
      {block.id !== "" && leads[block.id]}
      <ConfigGrid items={block.items} />
    </Fragment>
  ));
}

// 目录选中的分组和小组记在模块里（不随 AdvancedConfig 卸载）：换节再回来保持原样。
const pickedStore = createStore<{ group: string | null; prefix: string | null }>({ group: null, prefix: null });

const anchorId = (group: string, prefix: string) => `cfg-sub-${group}-${prefix === "" ? "other" : prefix}`;

/** 高级：左侧目录 + 选中分组的全部行（按前缀小标题分段）。 */
export function AdvancedConfig({ items }: { items: readonly OmpConfigItem[] }) {
  const t = useT();
  const locale = useLocale();
  const groups = useMemo(() => advancedGroups(items), [items]);
  const picked = useStoreValue(pickedStore, (state) => state);
  const current = groups.find((group) => group.group === picked.group) ?? groups[0];
  if (current === undefined) return null;
  const activePrefix = picked.prefix ?? current.prefixes[0]?.prefix ?? "";

  return (
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
                  pickedStore.set({ group: group.group, prefix: null });
                  event.currentTarget.closest(".settings-scroll")?.scrollTo({ top: 0 });
                }}
                data-testid={`advanced-toc-${group.group}`}
              >
                {groupTitle(locale, group.group)}
                <span className="ui-count">{group.count}</span>
              </button>
              <Reveal open={open}>
                {group.prefixes.map(({ prefix }) => (
                  <button
                    key={prefix}
                    type="button"
                    className="st-toc-item"
                    aria-current={prefix === activePrefix ? "true" : undefined}
                    onClick={() => {
                      pickedStore.set({ group: picked.group, prefix });
                      document.getElementById(anchorId(group.group, prefix))?.scrollIntoView({ block: "start" });
                    }}
                    data-testid={`advanced-toc-${group.group}-${prefix || "other"}`}
                  >
                    {prefix === "" ? t("settings.cfg.other") : prefixTitle(locale, prefix)}
                  </button>
                ))}
              </Reveal>
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
                prefix === "" ? (
                  t("settings.cfg.other")
                ) : (
                  <span title={`${prefix}.*`}>{prefixTitle(locale, prefix)}</span>
                )
              }
              count={modified > 0 ? t("settings.cfg.modifiedCount", { count: modified }) : undefined}
            />
            <ConfigGrid items={bucket} keyPrefix={prefix} allCells />
          </section>
        ))}
      </div>
    </div>
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
          <div className="st-rows">
            {inGroup.map((item) => (
              <ConfigRow key={item.key} item={item} query={query} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
