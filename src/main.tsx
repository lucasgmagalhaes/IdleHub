import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tauriBackend, tauriWindowControls } from "./backend";
import { createDemoBackend, demoWindowControls } from "./demoBackend";

// Outside the Tauri shell (plain `pnpm dev` in a browser) the UI runs on demo data.
const inTauri = "__TAURI_INTERNALS__" in window;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      backend={inTauri ? tauriBackend : createDemoBackend()}
      windowControls={inTauri ? tauriWindowControls : demoWindowControls}
    />
  </StrictMode>,
);
