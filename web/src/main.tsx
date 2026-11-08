import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { card } from "./card";

document.title = card.appName;
document.documentElement.style.setProperty("--accent", card.uiAccent);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
