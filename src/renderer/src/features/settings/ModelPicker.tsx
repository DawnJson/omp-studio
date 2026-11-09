// 自定义提供商对话框里"拉取模型"弹出的选择浮层：搜索、列出拉到的模型；已在列表里的显示为已勾选、不能再选，
// 勾选其余的（或"全部"勾上搜索出来的那些）、点"添加 N 个"追加到列表。浮层挂在拉取按钮下面（.cp-fetch，见 custom-providers.css）。
import { useMemo, useState } from "react";
import type { FetchedModel } from "../../../../shared/custom-models.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Checkbox, TextField } from "../../ui/controls.tsx";
import { Popover } from "../../ui/Popover.tsx";

interface ModelPickerProps {
  open: boolean;
  onClose(): void;
  models: readonly FetchedModel[];
  /** 已在模型列表里的 id。 */
  added: ReadonlySet<string>;
  onAdd(models: FetchedModel[]): void;
}

export function ModelPicker({ open, onClose, models, added, onAdd }: ModelPickerProps) {
  const t = useT();
  return (
    <Popover open={open} onClose={onClose} label={t("custom.form.models.pick")} width={360}>
      <PickerBody models={models} added={added} onAdd={onAdd} />
    </Popover>
  );
}

/** 每次打开重新挂载：勾选和搜索词不留到下一次。 */
function PickerBody({ models, added, onAdd }: Omit<ModelPickerProps, "open" | "onClose">) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return models;
    return models.filter(
      (model) => model.id.toLowerCase().includes(needle) || model.name?.toLowerCase().includes(needle) === true,
    );
  }, [models, query]);

  const add = () => {
    if (picked.size > 0) onAdd(models.filter((model) => picked.has(model.id)));
  };
  const toggle = (id: string, next: boolean) =>
    setPicked((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  // "全部"只管搜索出来、还没在列表里的：中转站一次拉到几百个时先搜再全选。
  const selectable = visible.filter((model) => !added.has(model.id));
  const pickedVisible = selectable.filter((model) => picked.has(model.id)).length;
  const toggleAll = (next: boolean) =>
    setPicked((current) => {
      const copy = new Set(current);
      for (const model of selectable) {
        if (next) copy.add(model.id);
        else copy.delete(model.id);
      }
      return copy;
    });

  return (
    <div className="cp-picker" data-testid="custom-picker">
      <TextField
        size="sm"
        width="100%"
        autoComplete="off"
        autoFocus
        value={query}
        placeholder={t("custom.form.models.filter")}
        aria-label={t("custom.form.models.filter")}
        testId="custom-picker-search"
        onChange={setQuery}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            // 浮层在提供商表单里：Enter 是"添加选中的"，不是"保存提供商"。
            event.preventDefault();
            event.stopPropagation();
            add();
          }
        }}
      />
      {visible.length === 0 ? (
        <p className="cp-text">{t("custom.form.models.empty")}</p>
      ) : (
        <div className="cp-picker-list">
          <Checkbox
            checked={selectable.length > 0 && pickedVisible === selectable.length}
            indeterminate={pickedVisible > 0 && pickedVisible < selectable.length}
            disabled={selectable.length === 0}
            testId="custom-picker-all"
            onChange={toggleAll}
          >
            {t("custom.form.models.all")}
          </Checkbox>
          {visible.map((model) => {
            const isAdded = added.has(model.id);
            return (
              <Checkbox
                key={model.id}
                checked={isAdded || picked.has(model.id)}
                disabled={isAdded}
                testId={`custom-pick-${model.id}`}
                onChange={(next) => toggle(model.id, next)}
              >
                <span className="cp-model-id" title={model.id}>
                  {model.id}
                </span>
              </Checkbox>
            );
          })}
        </div>
      )}
      <div className="ui-pop-actions">
        <Button variant="primary" size="sm" disabled={picked.size === 0} onClick={add} testId="custom-picker-add">
          {t("custom.form.models.pickAdd", { count: picked.size })}
        </Button>
      </div>
    </div>
  );
}
