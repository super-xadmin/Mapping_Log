import "leaflet/dist/leaflet.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { startSyncLoop } from "./lib/outbox";
import { recorder } from "./lib/recorder";

startSyncLoop();
recorder.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// ติดตั้งเป็นแอปบนมือถือได้ และเปิดหน้าเว็บได้แม้ไม่มีสัญญาณ
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
