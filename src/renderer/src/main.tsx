import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "./app/app.css";
import "./ui/motion.css";
import "./ui/scrollbars.css";
import { App } from "./app/App.tsx";
import { installScrollActivity } from "./ui/scroll-activity.ts";
import { startShellStore } from "./app/shell-store.ts";
import { startStores } from "./store/index.ts";
import { loadStartupSnapshot } from "./store/startup-snapshot.ts";

installScrollActivity();
startStores();
startShellStore();

const container = document.getElementById("root");
if (!container) throw new Error("index.html 里没有 #root");
// 先拿到工具行上次的数据（只读主进程内存/一个小文件，几毫秒），第一帧就画完整。
void loadStartupSnapshot().then(() =>
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
