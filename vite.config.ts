import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error import.meta.dirname is a Vite/Node runtime global, untyped here
const rootDir = import.meta.dirname as string;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // `@` → src for shadcn/ui imports; `base: "./"` keeps asset paths relative for
  // the tauri://localhost custom protocol.
  base: "./",
  resolve: {
    alias: { "@": `${rootDir}/src` },
  },

  // Multi-page: the main app plus the standalone Settings window entry.
  build: {
    rollupOptions: {
      input: {
        main: `${rootDir}/index.html`,
        settings: `${rootDir}/settings.html`,
      },
    },
  },

  // NOTE on bundle splitting: routes are already lazy-loaded via React.lazy in
  // the router, so each page (CvLibrary, JobSearch, AutomationCockpit, …) is
  // emitted as its own chunk — that is the frontend-startup win. A separate
  // "react-vendor" chunk was intentionally NOT added: this app is served from
  // the `tauri://localhost` custom protocol out of assets embedded in the app
  // binary, so there is no cross-update HTTP cache for a stable vendor hash to
  // benefit, and splitting React out does not reduce first-paint bytes/parse.

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and the Node automation dir. The worker writes
      //    DOM/PNG capture files under `automation/captures/` at runtime; Vite was doing a full page
      //    RELOAD on every capture, which (with the persisted auto-connect toggle) restarted the run
      //    on top of the still-open browser → reclaim killed it → "Target page closed" crash loop.
      //    None of `automation/**` is imported by the frontend, so ignoring it is safe.
      ignored: ["**/src-tauri/**", "**/automation/**"],
    },
  },
}));
