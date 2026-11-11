/// <reference types="vite/client" />
import type { StudioApi } from "../../shared/ipc.ts";
import type { PetApi } from "../../shared/pet/pet-ipc.ts";

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的全部接口（src/preload/index.ts）。 */
    studio: StudioApi;
    /** 只在宠物窗口里有（src/preload/pet.ts）；主窗口里是 undefined。 */
    pet: PetApi;
  }
}
