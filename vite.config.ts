import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
