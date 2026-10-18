// ask 门答了一半的内容：按请求 id 存在 store 里，门被卸载（切任务、进设置页再回来）后还在。请求被答复或消失后清掉。
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface QuestionState {
  selected: string[];
  otherOn: boolean;
  custom: string;
}

export interface AskDraft {
  step: number;
  states: QuestionState[];
}

const drafts = createStore<Readonly<Record<string, AskDraft>>>({});

function blank(questionCount: number): AskDraft {
  return {
    step: 0,
    states: Array.from({ length: questionCount }, () => ({ selected: [], otherOn: false, custom: "" })),
  };
}

export function updateAskDraft(dialogId: string, questionCount: number, update: (draft: AskDraft) => AskDraft): void {
  drafts.set({ ...drafts.get(), [dialogId]: update(drafts.get()[dialogId] ?? blank(questionCount)) });
}

export function useAskDraft(
  dialogId: string,
  questionCount: number,
): [AskDraft, (update: (draft: AskDraft) => AskDraft) => void] {
  const draft = useStoreValue(drafts, (state) => state[dialogId]);
  return [draft ?? blank(questionCount), (update) => updateAskDraft(dialogId, questionCount, update)];
}

export function clearAskDraft(dialogId: string): void {
  const { [dialogId]: _removed, ...rest } = drafts.get();
  drafts.set(rest);
}

export function getAskDraft(dialogId: string): AskDraft | undefined {
  return drafts.get()[dialogId];
}
