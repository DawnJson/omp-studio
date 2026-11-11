// 宠物窗口和主进程之间的 IPC（docs/architecture/pet.md「窗口」）。宠物窗口用自己的 preload（src/preload/pet.ts），
// 只拿到这里列的几个函数，拿不到主窗口的 StudioApi；主进程只认宠物窗口发来的这些通道（main/pet/pet-window.ts）。
import type { PetReaction, PetView } from "./model.ts";

export interface PetApi {
  getView(): Promise<PetView>;
  onView(listener: (view: PetView) => void): () => void;
  onReaction(listener: (reaction: PetReaction) => void): () => void;
  /** 指针按下在宠物身上：主进程跟着光标挪窗口，直到 dragEnd。 */
  dragStart(): void;
  dragEnd(): void;
  /** 指针在不在宠物 / 气泡 / 属性卡上：不在时窗口让鼠标穿透到下面。 */
  setInteractive(on: boolean): void;
  /** 单击 = 摸一下。 */
  pet(): void;
  /** 双击 = 打开 studio（有任务等你时切到它）。 */
  openStudio(): void;
  /** 右键 = 弹系统菜单。 */
  menu(): void;
  /** 属性卡里改名：开始编辑时让窗口能拿到键盘焦点，结束时还回去。 */
  setEditing(on: boolean): void;
  rename(name: string): Promise<void>;
}

/** 通道名：invoke 用 `pet:<名字>`，主进程推送用 `pet:event:<名字>`。 */
export const petChannel = (name: keyof PetApi) => `pet:${name}` as const;
export const petEventChannel = (name: "view" | "reaction") => `pet:event:${name}` as const;
