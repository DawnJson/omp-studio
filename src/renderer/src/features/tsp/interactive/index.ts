// 交互类节点的注册表，TspRenderCore 的节点注册表把它合并进去。
import type { ComponentType } from "react";
import type { NodeProps } from "../node-props.ts";
import { Editor } from "./Editor.tsx";
import { Item, List } from "./List.tsx";
import { Overlay } from "./Overlay.tsx";
import { Picker } from "./Picker.tsx";
import { Prefs } from "./Prefs.tsx";
import { Tabs } from "./Tabs.tsx";
import { Toast } from "./Toast.tsx";
import "./interactive.css";

export const interactiveNodes: Record<string, ComponentType<NodeProps>> = {
  editor: Editor,
  input: Editor,
  list: List,
  item: Item,
  picker: Picker,
  prefs: Prefs,
  tabs: Tabs,
  overlay: Overlay,
  toast: Toast,
};
