// 宠物窗口的页面（docs/design/spec/4.32-pet.md）：底部正中是宠物，上面是气泡 / 属性卡 / 升级提示。
// 透明的地方鼠标穿透：指针在带 data-pet-hit 的元素上时告诉主进程接住鼠标（setInteractive）。
// 宠物身上：按下拖动（主进程跟着光标挪窗口），没挪动就算单击 = 摸一下；双击打开 studio；右键弹系统菜单。
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createT } from "../../../shared/i18n/index.ts";
import {
  PET_NAME_MAX_CHARS,
  rarityInfo,
  statNames,
  type PetReaction,
  type PetView,
} from "../../../shared/pet/model.ts";
import { Button } from "../ui/controls.tsx";
import { PetSprite } from "./PetSprite.tsx";

/** 按下后挪动超过这么多像素就算拖动，不算单击。 */
const DRAG_THRESHOLD = 4;
/** 单击等这么久看是不是双击（双击不摸）。 */
const CLICK_DELAY_MS = 260;

/** 气泡停留：基础 5 秒，每个字多 60ms，最多 12 秒。 */
const bubbleMs = (text: string) => Math.min(12_000, 5000 + text.length * 60);

function applyPage(view: PetView): void {
  const root = document.documentElement;
  if (view.theme === null) delete root.dataset["theme"];
  else root.dataset["theme"] = view.theme;
  if (view.reduceMotion) root.dataset["motion"] = "reduced";
  else delete root.dataset["motion"];
  root.lang = view.locale;
}

/** 告诉主进程指针在不在可点的东西上；只在变化时发。 */
function useHitTracking(dragging: () => boolean): void {
  useEffect(() => {
    let interactive = false;
    const set = (next: boolean) => {
      if (next === interactive || dragging()) return;
      interactive = next;
      window.pet.setInteractive(next);
    };
    const onMove = (event: MouseEvent) =>
      set(event.target instanceof Element && event.target.closest("[data-pet-hit]") !== null);
    const onLeave = () => set(false);
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [dragging]);
}

function Card({ view, onClose }: { view: PetView; onClose: () => void }) {
  const t = createT(view.locale);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { bones, soul } = view;
  const stopEditing = () => {
    setEditing(false);
    setInvalid(false);
    window.pet.setEditing(false);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") stopEditing();
    if (event.key !== "Enter") return;
    const name = draft.trim();
    if (name === "" || name.length > PET_NAME_MAX_CHARS) {
      setInvalid(true);
      return;
    }
    void window.pet.rename(name).then(stopEditing, () => setInvalid(true));
  };
  const xpShare = view.levelXpNeeded === 0 ? 1 : view.levelXp / view.levelXpNeeded;
  return (
    <section className="pet-card" data-pet-hit data-testid="pet-card">
      <header className="pet-card-head">
        {editing ? (
          <input
            className="pet-card-name-input"
            value={draft}
            maxLength={PET_NAME_MAX_CHARS}
            autoFocus
            aria-invalid={invalid}
            aria-label={t("pet.rename")}
            title={invalid ? t("pet.renameInvalid") : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            onBlur={stopEditing}
            data-testid="pet-rename-input"
          />
        ) : (
          <button
            type="button"
            className="pet-card-name"
            title={t("pet.rename")}
            onClick={() => {
              setDraft(soul?.name ?? "");
              setEditing(true);
              window.pet.setEditing(true);
            }}
            data-testid="pet-name"
          >
            {soul?.name ?? t("pet.hatching")}
          </button>
        )}
        <span className="pet-card-meta">
          <span data-rarity={bones.rarity}>
            {"★".repeat(rarityInfo[bones.rarity].stars)} {t(`pet.rarity.${bones.rarity}`)}
          </span>
          <span>{t(`pet.species.${bones.species}`)}</span>
          {bones.shiny && <span className="pet-card-shiny">{t("pet.shiny")}</span>}
        </span>
        <button
          type="button"
          className="pet-card-close"
          aria-label={t("common.close")}
          onClick={onClose}
          data-testid="pet-card-close"
        >
          ×
        </button>
      </header>
      <div className="pet-card-level">
        <span>
          {t(`pet.stage.${view.stage}`)} · {t("pet.level", { level: view.level })}
        </span>
        <span className="pet-bar" role="progressbar" aria-valuenow={Math.round(xpShare * 100)} data-testid="pet-xp">
          <span className="pet-bar-fill" style={{ width: `${xpShare * 100}%` }} />
        </span>
      </div>
      <dl className="pet-card-stats">
        {statNames.map((name) => {
          const value = view.stats[name];
          const grown = view.growth[name];
          return (
            <div key={name} className="pet-stat">
              <dt>{t(`pet.stat.${name}`)}</dt>
              <dd>
                <span className="pet-bar">
                  <span className="pet-bar-fill" style={{ width: `${value - Math.min(grown, value)}%` }} />
                  <span className="pet-bar-grown" style={{ width: `${Math.min(grown, value)}%` }} />
                </span>
                <span className="pet-stat-value">{value}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {soul !== null && soul.personality !== "" && <p className="pet-card-personality">{soul.personality}</p>}
    </section>
  );
}

/**
 * 重新孵化的确认框：和 studio 的 ConfirmDialog 同一套样式（ui-dialog 的标题、说明、页脚，取消在前、danger-solid 在后），
 * 放在宠物窗口里属性卡的位置，不用系统对话框。打开时窗口临时可聚焦，焦点落在确认框本身（右键是鼠标操作，
 * 不在按钮上画焦点环；同 Dialog 没有 data-autofocus 时），Tab 进到按钮，Esc 取消。
 */
function RehatchConfirm({ view, onClose }: { view: PetView; onClose: () => void }) {
  const t = createT(view.locale);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    window.pet.setEditing(true);
    ref.current?.focus();
    return () => window.pet.setEditing(false);
  }, []);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="ui-dialog pet-confirm"
      role="alertdialog"
      aria-labelledby="pet-confirm-title"
      aria-describedby="pet-confirm-desc"
      data-pet-hit
      data-testid="pet-rehatch-confirm"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="ui-dialog-head">
        <div>
          <h2 id="pet-confirm-title" className="ui-dialog-title">
            {t("pet.rehatch.title")}
          </h2>
          <p id="pet-confirm-desc" className="ui-dialog-desc">
            {t("pet.rehatch.body")}
          </p>
        </div>
      </header>
      <footer className="ui-dialog-foot">
        <Button onClick={onClose} testId="pet-rehatch-cancel">
          {t("pet.rehatch.cancel")}
        </Button>
        <Button
          variant="danger-solid"
          onClick={() => {
            onClose();
            window.pet.rehatch();
          }}
          testId="pet-rehatch-confirm-button"
        >
          {t("pet.rehatch.confirm")}
        </Button>
      </footer>
    </section>
  );
}

interface PetAppProps {
  initial: PetView;
  /** 订阅主进程推来的动作（main.tsx 先攒着页面加载期间到的那些，订阅时补发）。 */
  subscribeReactions: (listener: (reaction: PetReaction) => void) => () => void;
}

export function PetApp({ initial, subscribeReactions }: PetAppProps) {
  const [view, setView] = useState(initial);
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const [badge, setBadge] = useState<{ text: string; key: number } | null>(null);
  const [hearts, setHearts] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const clickTimer = useRef<number | undefined>(undefined);
  const localeRef = useRef(initial.locale);
  localeRef.current = view.locale;
  const dragging = useRef(() => dragRef.current !== null).current;
  useHitTracking(dragging);

  useEffect(() => {
    applyPage(view);
  }, [view]);

  useEffect(() => {
    const offView = window.pet.onView(setView);
    let key = 0;
    const timers = new Set<number>();
    const later = (ms: number, run: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        run();
      }, ms);
      timers.add(id);
    };
    const offReaction = subscribeReactions((reaction) => {
      key += 1;
      const current = key;
      switch (reaction.kind) {
        case "say":
          setBubble({ text: reaction.text, key: current });
          later(bubbleMs(reaction.text), () => setBubble((shown) => (shown?.key === current ? null : shown)));
          break;
        case "hearts":
          setHearts(current);
          later(2500, () => setHearts((shown) => (shown === current ? 0 : shown)));
          break;
        case "levelUp":
        case "evolve": {
          const t = createT(localeRef.current);
          const text =
            reaction.kind === "levelUp" ? t("pet.level", { level: reaction.level }) : t(`pet.stage.${reaction.stage}`);
          setBadge({ text, key: current });
          later(3000, () => setBadge((shown) => (shown?.key === current ? null : shown)));
          break;
        }
        case "card":
          setConfirmOpen(false);
          setCardOpen(true);
          break;
        case "confirmRehatch":
          setCardOpen(false);
          setConfirmOpen(true);
          break;
      }
    });
    return () => {
      offView();
      offReaction();
      for (const id of timers) window.clearTimeout(id);
    };
  }, [subscribeReactions]);

  const t = createT(view.locale);
  const name = view.soul?.name ?? t("pet.hatching");
  const label = `${name} · ${t(`pet.species.${view.bones.species}`)} · ${t("pet.level", { level: view.level })}`;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.screenX, y: event.screenY, moved: false };
    window.pet.dragStart();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.moved) return;
    if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > DRAG_THRESHOLD) drag.moved = true;
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.pet.dragEnd();
    if (drag === null || drag.moved) return;
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => window.pet.pet(), CLICK_DELAY_MS);
  };

  return (
    <div className="pet-root" data-card={cardOpen || confirmOpen || undefined}>
      {confirmOpen ? (
        <RehatchConfirm view={view} onClose={() => setConfirmOpen(false)} />
      ) : cardOpen ? (
        <Card view={view} onClose={() => setCardOpen(false)} />
      ) : (
        bubble !== null &&
        view.talk && (
          <div
            key={bubble.key}
            className="pet-bubble"
            data-pet-hit
            role="status"
            onClick={() => setBubble(null)}
            data-testid="pet-bubble"
          >
            {bubble.text}
          </div>
        )
      )}
      {badge !== null && (
        <div key={badge.key} className="pet-badge" data-testid="pet-badge">
          {badge.text}
        </div>
      )}
      {hearts !== 0 && (
        <div key={hearts} className="pet-hearts" aria-hidden="true">
          <span>♥</span>
          <span>♥</span>
          <span>♥</span>
        </div>
      )}
      <div
        className="pet-stage"
        data-pet-hit
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          window.clearTimeout(clickTimer.current);
          window.pet.openStudio();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          window.pet.menu();
        }}
      >
        <PetSprite bones={view.bones} stage={view.stage} mood={view.mood} label={label} />
      </div>
    </div>
  );
}
