// 新任务默认值的 hook（草稿输入框、起进程前的任务输入框共用）：初值是上次读到的（new-task-default.ts：本次运行里最近一次现读，
// 没有就用启动缓存），现读的结果到了再替换；显示什么模型、什么强度的纯计算在 shared/ui/new-task-default.ts。
// 这个项目的默认值还没读到过时（resolved.pending）输入框显示占位，不拿全局默认值或别的项目的值顶替。
// 草稿里"用于此任务"选过的项（draft-model-choice.ts）盖过配置里的默认值，其余照旧。
import { useEffect, useReducer, useState } from "react";
import type { DefaultModelInfo, ModelDefaults, ModelOption, ProjectId } from "../../../../shared/ipc.ts";
import type { DraftModelChoice } from "./draft-model-choice.ts";
import { resolveNewTaskDefault, type NewTaskDefault } from "../../../../shared/ui/new-task-default.ts";
import {
  knownDefaults,
  knownModels,
  knownOmp,
  rememberDefaults,
  rememberModels,
  rememberOmp,
} from "./new-task-default.ts";

/** 读不到这个项目的配置（omp 没就绪等）时按"什么都没配"算：显示 omp 自己选的默认模型。 */
const noConfig: Pick<ModelDefaults, "model" | "thinkingLevel"> = { model: null, thinkingLevel: null };

export interface NewTaskDefaultView {
  resolved: NewTaskDefault;
  /** omp 自选的默认模型；undefined = 还没读到过，null = omp 一个可用模型都没有。 */
  omp: DefaultModelInfo | null | undefined;
  models: ModelOption[] | null;
}

/** enabled 为 false 时不读（任务已经有进程、模型来自进程时用不着）。 */
export function useNewTaskDefault(
  projectId: ProjectId | null,
  enabled = true,
  choice?: DraftModelChoice,
): NewTaskDefaultView {
  const [omp, setOmp] = useState<DefaultModelInfo | null | undefined>(knownOmp);
  const [models, setModels] = useState<ModelOption[] | null>(knownModels);
  const [failedFor, setFailedFor] = useState<ProjectId | null | undefined>(undefined);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // 内容没变的 omp 默认模型（每次现读都是新对象）不触发重读。
  const ompKey = JSON.stringify(omp);

  useEffect(() => {
    if (!enabled) return;
    const apply = (value: DefaultModelInfo | null) => {
      rememberOmp(value);
      setOmp(value);
    };
    window.studio.getDefaultModel().then(apply, () => apply(null));
    return window.studio.onDefaultModel(apply);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const apply = (value: ModelOption[]) => {
      rememberModels(value);
      setModels(value);
    };
    window.studio.listModels().then(apply, () => setModels([]));
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    window.studio.getModelDefaults(projectId).then(
      (value) => {
        rememberDefaults(projectId, value);
        if (current) rerender();
      },
      () => {
        if (current) setFailedFor(projectId);
      },
    );
    return () => {
      current = false;
    };
    // omp 变了（别处改了 omp 设置会推 defaultModel 事件）也重读。
  }, [enabled, projectId, ompKey]);

  const known = knownDefaults(projectId) ?? (failedFor === projectId ? noConfig : null);
  const defaults =
    known === null || choice === undefined
      ? known
      : {
          model: choice.model === null ? known.model : `${choice.model.provider}/${choice.model.modelId}`,
          thinkingLevel: choice.thinkingLevel ?? known.thinkingLevel,
        };
  return { resolved: resolveNewTaskDefault(defaults, omp, models), omp, models };
}
