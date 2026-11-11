// 桌面宠物的主进程逻辑（docs/architecture/pet.md）：开关窗口、汇总任务状态成表情、记成长、孵化和说话。
// 任务状态从 tasks/runtime.ts 的 state / taskRemoved 事件进来；设置（petEnabled、petTalk、主题、语言、减少动效）变了重推一次画面。
import path from "node:path";
import { app, dialog, type MenuItemConstructorOptions } from "electron";
import type { TaskId, TaskState } from "../../shared/ipc.ts";
import { t } from "../../shared/i18n/index.ts";
import { rollBones } from "../../shared/pet/bones.ts";
import {
  applyEvent,
  currentStats,
  levelOf,
  maxLevel,
  stageOf,
  xpForLevel,
  dayKey,
  type XpSource,
} from "../../shared/pet/growth.ts";
import { PET_NAME_MAX_CHARS, type Bones, type Mood, type PetSpend, type PetView } from "../../shared/pet/model.ts";
import { eventToVoice, PetTaskTracker, summarizeMood, type PetTaskEvent } from "../../shared/pet/mood.ts";
import { emitEvent } from "../ipc/events.ts";
import { listOmpConfig } from "../ipc/omp-handlers.ts";
import { log } from "../log/log.ts";
import { readModelRoles } from "../omp-config/model-defaults.ts";
import { oneShotOmp } from "../prompt-enhance/one-shot-omp.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { getSettings, onSettingsChanged, resolveLocale, updateSettings } from "../settings/settings-store.ts";
import { showMainWindow } from "../window/show-window.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { addSpend, PetStore, rehatched, spendOn } from "./pet-store.ts";
import { chooseVoiceModel, hatchSoul, speakLine, type VoiceRunner, type VoiceTrigger } from "./pet-voice.ts";
import { closePetWindow, getPetWindow, openPetWindow, sendPetReaction, sendPetView } from "./pet-window.ts";

/** 跑完一轮后"开心"的样子保持多久。 */
const DONE_MS = 4000;
/** 自己开口（任务事件）至少隔多久；被摸时至少隔多久才再说一句（之间只冒爱心）。升级、进化不受限。 */
const AUTO_TALK_GAP_MS = 45_000;
const PET_TALK_GAP_MS = 20_000;

let store: PetStore | null = null;
let bones: Bones | null = null;
const tracker = new PetTaskTracker();
let tasks: readonly TaskState[] = [];
let doneUntil = 0;
let doneTimer: NodeJS.Timeout | undefined;
let lastMood: Mood = "idle";
let lastSpokeAt = 0;
/** 进行中的 omp 调用（孵化、说话）；重新孵化、关掉宠物、退出时全部取消。 */
const voices = new Set<AbortController>();
/** cancelVoices 一次加一；正在孵化的那一代（没有为 null）。 */
let voiceGeneration = 0;
let hatchingGeneration: number | null = null;

function mood(): Mood {
  const base = summarizeMood(tasks);
  return (base === "idle" || base === "running") && Date.now() < doneUntil ? "done" : base;
}

function view(): PetView {
  const current = store!.get();
  const level = levelOf(current.growth.xp);
  const settings = getSettings();
  return {
    bones: bones!,
    stage: stageOf(level),
    level,
    levelXp: current.growth.xp - xpForLevel(level),
    levelXpNeeded: level >= maxLevel ? 0 : xpForLevel(level + 1) - xpForLevel(level),
    stats: currentStats(bones!, current.growth),
    growth: { ...current.growth.statGrowth },
    soul: current.soul,
    mood: mood(),
    talk: settings.petTalk,
    locale: resolveLocale(),
    theme: settings.theme === "system" ? null : settings.theme,
    reduceMotion: settings.reduceMotion,
  };
}

function push(): void {
  if (store === null || getPetWindow() === null) return;
  lastMood = mood();
  sendPetView(view());
}

async function voiceRunner(signal: AbortSignal): Promise<VoiceRunner> {
  const cwd = await serviceCwd();
  // 读不到配置不挡：交给 omp 自己解析 @smol（同提示词优化）。
  const roles = await readModelRoles({ list: listOmpConfig }, cwd).catch(() => null);
  return {
    omp: await oneShotOmp("STUDIO_TEST_PET_OMP"),
    cwd,
    model: chooseVoiceModel(roles),
    signal,
    onSpend: (spend) => store?.update({ spend: addSpend(store.get().spend, spend, dayKey(new Date())) }),
  };
}

async function withVoice<T>(work: (runner: VoiceRunner) => Promise<T | null>): Promise<T | null> {
  const controller = new AbortController();
  voices.add(controller);
  try {
    return await work(await voiceRunner(controller.signal));
  } catch (error) {
    log.warn("pet voice unavailable", error instanceof Error ? error.message : error);
    return null;
  } finally {
    voices.delete(controller);
  }
}

function cancelVoices(): void {
  for (const controller of voices) controller.abort();
  voices.clear();
  // 被取消的孵化不再挡住下一次（它的 finally 可能要等几秒才跑到）。
  voiceGeneration += 1;
}

/**
 * 还没有魂就孵化一次；失败不重试，等下次打开窗口（启动、重新打开、重新孵化）再试。
 * 同时只有一次在孵：重新孵化、关掉宠物会先 cancelVoices 换一代，新的一次不被还没收尾的旧的挡住。
 */
async function hatch(): Promise<void> {
  const generation = voiceGeneration;
  if (store === null || hatchingGeneration === generation || store.get().soul !== null) return;
  hatchingGeneration = generation;
  const seed = store.get().seed;
  try {
    const soul = await withVoice((runner) => hatchSoul(runner, bones!, resolveLocale(), Date.now()));
    // 孵化途中被取消、重新孵化过（种子变了）或已经改了名：这次的魂作废。
    if (soul === null || voiceGeneration !== generation || store.get().seed !== seed || store.get().soul !== null)
      return;
    store.update({ soul });
    log.info("pet hatched", { species: bones!.species, rarity: bones!.rarity });
    push();
  } finally {
    if (hatchingGeneration === generation) hatchingGeneration = null;
  }
}

/** 说一句（说话关着、还没孵化好、或离上一句太近时不说）。force：升级、进化，不看间隔。 */
function say(trigger: VoiceTrigger, gapMs: number, force = false): void {
  const soul = store?.get().soul ?? null;
  if (!getSettings().petTalk || soul === null || getPetWindow() === null) return;
  const now = Date.now();
  if (!force && now - lastSpokeAt < gapMs) return;
  lastSpokeAt = now;
  const pet = { bones: bones!, stats: currentStats(bones!, store!.get().growth), soul };
  void withVoice((runner) => speakLine(runner, pet, trigger, resolveLocale())).then((text) => {
    if (text !== null && getSettings().petTalk) sendPetReaction({ kind: "say", text });
  });
}

/** 记一次成长事件；升级、进化时冒提示，mayTalk 时让它说一句（一次状态变化里只第一次升级说话）。 */
function grow(source: Exclude<XpSource, "daily">, mayTalk = true): void {
  if (store === null) return;
  const step = applyEvent(store.get().growth, source, new Date());
  store.update({ growth: step.growth });
  if (step.evolved !== null) {
    sendPetReaction({ kind: "evolve", stage: step.evolved });
    if (mayTalk) say({ kind: "evolve", stage: step.evolved }, 0, true);
  } else if (step.levelUp !== null) {
    sendPetReaction({ kind: "levelUp", level: step.levelUp });
    if (mayTalk) say({ kind: "levelUp", level: step.levelUp }, 0, true);
  }
}

function onTaskEvent(event: PetTaskEvent, mayTalk: boolean): void {
  grow(event.kind, mayTalk);
  if (event.kind === "turn") {
    doneUntil = Date.now() + DONE_MS;
    clearTimeout(doneTimer);
    doneTimer = setTimeout(push, DONE_MS + 50);
  }
}

/** runtime.ts 的 state 事件：记成长、换表情。 */
export function petOnTaskState(state: TaskState, all: readonly TaskState[]): void {
  tasks = all;
  if (store === null) return;
  const spokeBefore = lastSpokeAt;
  const events = tracker.update(state);
  for (const event of events) onTaskEvent(event, lastSpokeAt === spokeBefore);
  // 一次变化最多说一句：升级 / 进化已经开口就不再说事件；出错后修好的那句不看间隔（优先于同时到来的"跑完一轮"）。
  const voiced = eventToVoice(events);
  if (voiced !== null && lastSpokeAt === spokeBefore)
    say({ kind: voiced.kind, title: voiced.title }, voiced.kind === "recovered" ? 0 : AUTO_TALK_GAP_MS);
  const before = lastMood;
  push();
  if (before !== "waiting" && lastMood === "waiting" && state.status === "needs_you")
    say({ kind: "waiting", title: state.title }, AUTO_TALK_GAP_MS);
}

export function petOnTaskRemoved(id: TaskId, all: readonly TaskState[]): void {
  tasks = all;
  tracker.forget(id);
  push();
}

function petIt(): void {
  if (store === null) return;
  sendPetReaction({ kind: "hearts" });
  grow("pet");
  push();
  say({ kind: "pet" }, PET_TALK_GAP_MS);
}

function openStudio(): void {
  showMainWindow();
  const waiting = tasks.find((task) => task.status === "needs_you");
  if (waiting !== undefined) emitEvent("focusTask", waiting.id);
}

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "" || name.length > PET_NAME_MAX_CHARS) throw new Error(t(resolveLocale(), "pet.renameInvalid"));
  return name;
}

/** 改名；还没孵化好时也能先起名（性格留空，孵化不再覆盖名字）。 */
export async function renamePet(raw: unknown): Promise<void> {
  if (store === null) return;
  const name = parseName(raw);
  const soul = store.get().soul;
  store.update({ soul: soul === null ? { name, personality: "", hatchedAt: Date.now() } : { ...soul, name } });
  push();
}

async function confirmRehatch(): Promise<void> {
  const locale = resolveLocale();
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: t(locale, "pet.rehatch.title"),
    message: t(locale, "pet.rehatch.title"),
    detail: t(locale, "pet.rehatch.body"),
    buttons: [t(locale, "pet.rehatch.confirm"), t(locale, "pet.rehatch.cancel")],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0 || store === null) return;
  cancelVoices();
  const next = store.update(rehatched(store.get()));
  bones = rollBones(next.seed);
  log.info("pet rehatched");
  push();
  void hatch();
}

function menu(): MenuItemConstructorOptions[] {
  const locale = resolveLocale();
  return [
    { label: t(locale, "pet.menu.pet"), click: petIt },
    { label: t(locale, "pet.menu.card"), click: () => sendPetReaction({ kind: "card" }) },
    { type: "separator" },
    {
      label: t(locale, "pet.menu.talk"),
      type: "checkbox",
      checked: getSettings().petTalk,
      click: () => updateSettings({ petTalk: !getSettings().petTalk }),
    },
    { label: t(locale, "pet.menu.rehatch"), click: () => void confirmRehatch() },
    { type: "separator" },
    { label: t(locale, "pet.menu.open"), click: openStudio },
    { label: t(locale, "pet.menu.hide"), click: () => updateSettings({ petEnabled: false }) },
  ];
}

function showWindow(): void {
  if (store === null) return;
  openPetWindow(store.get().position, {
    getView: view,
    pet: petIt,
    openStudio,
    menu,
    rename: renamePet,
    // 单击也会走一次 dragEnd：位置没变就不写盘。
    moved: (position) => {
      const old = store?.get().position;
      if (old?.x !== position.x || old.y !== position.y) store?.update({ position });
    },
  });
  void hatch();
}

/** 跟着设置开关窗口；其余设置变化重推画面。 */
function syncSettings(): void {
  if (store === null) return;
  if (getSettings().petEnabled) {
    if (getPetWindow() === null) showWindow();
    else push();
  } else if (getPetWindow() !== null) {
    cancelVoices();
    closePetWindow();
  }
}

/**
 * 主窗口第一次淡入后调用一次：读 pet.json、按设置打开窗口。
 * 未打包时 STUDIO_E2E_NO_PET=1（e2e 的默认，test/e2e/launch.ts）不起宠物：多一个窗口会干扰按"第一个窗口""所有窗口"取窗口的用例。
 */
export function startPet(initialTasks: readonly TaskState[]): void {
  if (store !== null) return;
  if (!app.isPackaged && process.env["STUDIO_E2E_NO_PET"] === "1") return;
  store = new PetStore(path.join(app.getPath("userData"), "pet.json"));
  // 文件里没有种子（第一次）或坏了时 parsePetRecord 换了新种子：马上写下来，下次启动还是这只。
  store.update({});
  bones = rollBones(store.get().seed);
  tasks = initialTasks;
  for (const task of initialTasks) tracker.update(task);
  onSettingsChanged(syncSettings);
  syncSettings();
}

/** 主窗口的 IPC（设置页、/pet）：摸一下或打开属性卡；宠物没显示时先显示。 */
export function petAction(action: "pet" | "card"): void {
  if (store === null) return;
  if (!getSettings().petEnabled) updateSettings({ petEnabled: true });
  const run = () => (action === "pet" ? petIt() : sendPetReaction({ kind: "card" }));
  // 窗口被系统关掉（Alt+F4 等，hide-on-close 放行）时 petEnabled 还是 true：这里重新打开。
  if (getPetWindow() === null) showWindow();
  const window = getPetWindow();
  if (window === null) return;
  if (window.webContents.isLoading()) window.webContents.once("did-finish-load", run);
  else run();
}

/** 设置页看的花费；宠物没启动过（e2e 默认不起）时 null。 */
export function petSpend(): PetSpend | null {
  return store === null ? null : spendOn(store.get().spend, dayKey(new Date()));
}

registerShutdownHook(async () => {
  cancelVoices();
  closePetWindow();
  await store?.flush();
});
