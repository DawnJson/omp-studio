// 节点表（surface.nodes，Map）的插入顺序是改动历史，不是文档顺序：omp 更新子代理卡片是 del + add（节点挪到表尾），
// 关掉（keep）又接管的 surface 在 `doc.live` 里也会挪到最后。界面看到的顺序、"取第一个 / 最后一个"都不能跟着它变。
// 逐个回放 fixtures/tsp/ 的全部录制，每条消息之后把文档复制一份、用固定种子打乱每个节点表和 `doc.live` 的插入顺序，
// 下面每个推导在两份文档上的结果必须相同。新增按文档推导界面数据的导出函数时加进 PROBES。
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countActiveAgents,
  countEchoNodes,
  findAgentHub,
  findFocus,
  findHubOpener,
  listAgents,
} from "../src/shared/tsp/agent-hub.ts";
import { openAskTool } from "../src/shared/tsp/ask-gate.ts";
import { findBtwView } from "../src/shared/tsp/btw.ts";
import { compactionMark } from "../src/shared/tsp/compaction.ts";
import { deriveComposerFacts } from "../src/shared/tsp/composer-facts.ts";
import {
  deriveComposerInfo,
  findComposerCard,
  findComposerTargets,
  findPicker,
  statusToastTexts,
} from "../src/shared/tsp/composer-state.ts";
import { deriveContextCompaction } from "../src/shared/tsp/context-compaction.ts";
import { findContextReport } from "../src/shared/tsp/context-report.ts";
import { applyMessage, createDocument, type DocSurface, type TspDocument } from "../src/shared/tsp/document.ts";
import { foreignEditorText } from "../src/shared/tsp/editor-prefill.ts";
import { errorLines, newErrorLine, warningLines } from "../src/shared/tsp/error-lines.ts";
import { kbdChordsIn } from "../src/shared/tsp/forward-keys.ts";
import { findMessageTarget, hasBlockingPanel } from "../src/shared/tsp/gate.ts";
import { findGoalDropPrompt } from "../src/shared/tsp/goal.ts";
import { editorDraft, pendingImageCount } from "../src/shared/tsp/image-paste.ts";
import { agentStatuses, deriveJobTiles, deriveTspJobs, findJobsHudSeg } from "../src/shared/tsp/jobs.ts";
import { lastAnswerText } from "../src/shared/tsp/last-answer.ts";
import { deriveLoginFlow } from "../src/shared/tsp/login-flow.ts";
import { hasQueuedMessages } from "../src/shared/tsp/queue-restore.ts";
import {
  findComposerEditor,
  findSummaryPicker,
  findTreeLabelInput,
  findTreePicker,
  hasNavigatedToast,
} from "../src/shared/tsp/session-tree.ts";
import { deriveTaskStatus, hasRunningWork } from "../src/shared/tsp/task-status.ts";
import { deriveTodoPhases } from "../src/shared/tsp/todos.ts";
import { toolRunsBySurface } from "../src/shared/tsp/tool-runs.ts";
import { userMessages } from "../src/shared/tsp/user-messages.ts";
import { deriveWorkingLabel } from "../src/shared/tsp/working.ts";
import { loadTspFixture, tspDocMessages, tspFixtureDir } from "./tsp-fixtures.ts";

/** Map / Set 转成数组（toEqual 比 Map / Set 不看顺序）；本来就是集合语义的结果排好序再比。 */
const sorted = (values: Iterable<string>): string[] => [...values].sort();

const PROBES: Record<string, (doc: TspDocument) => unknown> = {
  listAgents,
  countActiveAgents,
  findAgentHub,
  findHubOpener,
  findFocus,
  countEchoNodes,
  openAskTool,
  findBtwView,
  compactionMark: (doc) => {
    const mark = compactionMark(doc);
    return { sections: sorted(mark.sections), errors: sorted(mark.errors) };
  },
  deriveComposerFacts,
  findComposerCard: (doc) => {
    const found = findComposerCard(doc);
    return found && { sf: found.surface.id, card: found.card.id };
  },
  deriveComposerInfo,
  findComposerTargets,
  findPicker,
  statusToastTexts,
  deriveContextCompaction,
  findContextReport,
  foreignEditorText,
  errorLines: (doc) => [...errorLines(doc)],
  warningLines: (doc) => [...warningLines(doc)],
  newErrorLine: (doc) => newErrorLine(doc, new Map()),
  kbdChordsIn: (doc) => sorted(kbdChordsIn(doc)),
  hasBlockingPanel,
  findMessageTarget,
  findGoalDropPrompt,
  pendingImageCount,
  editorDraft: (doc) => editorDraft(doc, ""),
  agentStatuses: (doc) => [...agentStatuses(doc)],
  deriveTspJobs: (doc) => deriveTspJobs(doc, agentStatuses(doc), 0),
  findJobsHudSeg,
  deriveJobTiles,
  lastAnswerText,
  deriveLoginFlow,
  hasQueuedMessages,
  findTreePicker,
  findSummaryPicker,
  findComposerEditor,
  hasNavigatedToast,
  findTreeLabelInput,
  deriveTaskStatus,
  hasRunningWork,
  deriveTodoPhases,
  toolRunsBySurface: (doc) => [...toolRunsBySurface(doc)],
  userMessages,
  deriveWorkingLabel,
};

/** mulberry32：固定种子，失败可复现。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1));
    [out[index], out[pick]] = [out[pick]!, out[index]!];
  }
  return out;
}

/** 内容相同、节点表和 `live` 插入顺序打乱的副本。`doc.surfaces` 的顺序是打开顺序（文档模型的约定，见 document.ts），不打乱。 */
function scrambled(doc: TspDocument, random: () => number): TspDocument {
  const surfaces = new Map<string, DocSurface>();
  for (const surface of doc.surfaces.values())
    surfaces.set(surface.id, { ...surface, nodes: new Map(shuffled([...surface.nodes], random)) });
  return { surfaces, live: new Set(shuffled([...doc.live], random)), blobs: doc.blobs, revealSeq: doc.revealSeq };
}

const fixtures = readdirSync(tspFixtureDir)
  .filter((file) => file.endsWith(".jsonl"))
  .map((file) => file.slice(0, -".jsonl".length));

describe("TSP 推导不依赖节点表的插入顺序", () => {
  it("找到录制", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("%s", (name) => {
    const random = seededRandom(0x5eed);
    const doc = createDocument();
    tspDocMessages(loadTspFixture(name)).forEach(({ message }, index) => {
      applyMessage(doc, message);
      const copy = scrambled(doc, random);
      for (const [probe, derive] of Object.entries(PROBES))
        expect(derive(copy), `${name} 第 ${index} 条消息之后的 ${probe}`).toEqual(derive(doc));
    });
  });
});
