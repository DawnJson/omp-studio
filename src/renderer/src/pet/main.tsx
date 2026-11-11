// 宠物窗口的入口（pet.html）：只用主题 token 和自己的样式，不载入主界面的 store；数据全由主进程推（window.pet）。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles/tokens.css";
import "../../styles/themes.css";
import "./pet.css";
import type { PetReaction } from "../../../shared/pet/model.ts";
import { PetApp } from "./PetApp.tsx";

// 页面一加载就订阅：主进程在页面加载完时可能马上发来"打开属性卡"等动作，那时界面还在等 getView。先攒着，界面订阅时补发。
const pending: PetReaction[] = [];
let deliver: ((reaction: PetReaction) => void) | null = null;
window.pet.onReaction((reaction) => (deliver === null ? pending.push(reaction) : deliver(reaction)));

function subscribeReactions(listener: (reaction: PetReaction) => void): () => void {
  deliver = listener;
  for (const reaction of pending.splice(0)) listener(reaction);
  return () => {
    if (deliver === listener) deliver = null;
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("pet.html 里没有 #root");
const root = createRoot(container);
void window.pet.getView().then((view) =>
  root.render(
    <StrictMode>
      <PetApp initial={view} subscribeReactions={subscribeReactions} />
    </StrictMode>,
  ),
);
