import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// JetBrains Mono - offline-safe font wiring for the cockpit. The 400/500/600/700
// weights cover body text, medium emphasis, section labels, and bold headings.
// Loaded before theme.css so `font-family: var(--font-ui)` resolves to a
// present family on first paint (no FOUT flash between system-fallback and
// JetBrains Mono).
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
// Per-theme display/UI faces (self-hosted, offline). Each named theme overrides
// --font-ui / --font-display in its theme.css token block; the weights below are
// the ones those tokens actually resolve to (regular→bold for UI, semibold/bold
// for display headings). "dark"/"light" keep the JetBrains Mono stack above.
//   solo-leveling → Chakra Petch (UI) + Orbitron (display) - sci-fi system window
//   red           → Rajdhani (UI) + Oxanium (display)      - sharp condensed crimson
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "./styles/theme.css";
import "./styles/effects.css";
import "./styles/redesign.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
