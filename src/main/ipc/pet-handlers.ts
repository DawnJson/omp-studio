// 主窗口里管宠物的 IPC（设置页的开关、/pet）：校验参数，委托 pet/pet-service.ts。宠物窗口自己的 IPC 在 pet/pet-window.ts。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { PET_NAME_MAX_CHARS } from "../../shared/pet/model.ts";
import { petAction, petSpend, renamePet } from "../pet/pet-service.ts";
import { updateSettings } from "../settings/settings-store.ts";
import { parseBoolean, parseOneOf, parseString } from "./validate.ts";

export const petHandlers: HandlerGroup<"setPetEnabled" | "setPetTalk" | "petAction" | "renamePet" | "getPetSpend"> = {
  setPetEnabled: async (on) => updateSettings({ petEnabled: parseBoolean(on, "petEnabled") }),
  setPetTalk: async (on) => updateSettings({ petTalk: parseBoolean(on, "petTalk") }),
  petAction: async (action) => petAction(parseOneOf(action, "action", ["pet", "card"])),
  // 长度按去掉首尾空白后算（renamePet 里再校验一次）；这里先挡住超长的原始值。
  renamePet: (name) => renamePet(parseString(name, "name", PET_NAME_MAX_CHARS * 4)),
  getPetSpend: async () => petSpend(),
};
