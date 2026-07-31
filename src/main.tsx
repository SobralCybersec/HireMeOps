import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Type system (self-hosted, offline). Loaded before theme.css so the
// `var(--font-*)` families resolve on first paint (no FOUT). Paired to rhyme with
// the Libra Heart pixel display face without wrecking readability:
//   The Libra Heart Font → hero/brand + display titles (pixel; @font-face in theme.css)
//   Chakra Petch         → UI labels + body (squared HUD sans, readable at 13-14px)
//   IBM Plex Mono        → data / IDs / code (tight retro-terminal, table-safe)
//   Calistoga            → warm serif fallback for title text
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/calistoga/400.css";
import "./styles/theme.css";
import "./styles/effects.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
