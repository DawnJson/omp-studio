import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { startStores } from "./store/index.ts";

startStores();

const container = document.getElementById("root");
if (!container) throw new Error("index.html 里没有 #root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
