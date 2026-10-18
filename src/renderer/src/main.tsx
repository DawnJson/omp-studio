import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "./app/app.css";
import { App } from "./app/App.tsx";
import { startShellStore } from "./app/shell-store.ts";
import { startStores } from "./store/index.ts";

startStores();
startShellStore();

const container = document.getElementById("root");
if (!container) throw new Error("index.html 里没有 #root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
