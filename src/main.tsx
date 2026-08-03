import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Batman / WayneTech type system (self-hosted, offline). Loaded before the stylesheets so the
// `var(--font-*)` families resolve on first paint:
//   Orbitron        → logo/wordmark
//   Rajdhani        → nav / sidebar
//   Roboto Condensed → main titles
//   Inter           → cards / body / small labels
//   JetBrains Mono  → numbers / logs / metrics
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/roboto-condensed/400.css";
import "@fontsource/roboto-condensed/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/700.css";
import "./styles/theme.css";
import "./styles/effects.css";
import "./styles/effects-modern.css";
import "./styles/tailwind.css";
// terax-ai design migration — remaps tokens/fonts to terax's look; MUST load last to win the cascade.
import "./styles/terax-theme.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
