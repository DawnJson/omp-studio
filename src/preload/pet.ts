// 宠物窗口的 preload（沙箱，CJS）：只暴露 PetApi 的几个函数，不暴露 ipcRenderer，也没有主窗口的 StudioApi。
// 校验在主进程（src/main/pet/pet-window.ts）。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { PetReaction, PetView } from "../shared/pet/model.ts";
import { petChannel, petEventChannel, type PetApi } from "../shared/pet/pet-ipc.ts";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api: PetApi = {
  getView: () => ipcRenderer.invoke(petChannel("getView")) as Promise<PetView>,
  onView: (listener) => subscribe<PetView>(petEventChannel("view"), listener),
  onReaction: (listener) => subscribe<PetReaction>(petEventChannel("reaction"), listener),
  dragStart: () => ipcRenderer.send(petChannel("dragStart")),
  dragEnd: () => ipcRenderer.send(petChannel("dragEnd")),
  setInteractive: (on) => ipcRenderer.send(petChannel("setInteractive"), on),
  pet: () => ipcRenderer.send(petChannel("pet")),
  openStudio: () => ipcRenderer.send(petChannel("openStudio")),
  menu: () => ipcRenderer.send(petChannel("menu")),
  setEditing: (on) => ipcRenderer.send(petChannel("setEditing"), on),
  rename: (name) => ipcRenderer.invoke(petChannel("rename"), name) as Promise<void>,
};

contextBridge.exposeInMainWorld("pet", api);
