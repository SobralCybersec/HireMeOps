import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { useSettingsStore } from "./stores/useSettingsStore";
import { startEventBridge } from "./lib/eventBridge";
import "./App.css";

function App() {
  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
    void startEventBridge();
  }, []);

  return <RouterProvider router={router} />;
}

export default App;
