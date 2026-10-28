import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tauriBackend } from "./backend";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App backend={tauriBackend} />
  </StrictMode>,
);
