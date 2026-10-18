/// <reference types="vite/client" />
import type { StudioApi } from "../../shared/ipc.ts";

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的全部接口（src/preload/index.ts）。 */
    studio: StudioApi;
  }
}
