import { useCallback, useEffect } from "react";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";

/**
 * Always-visible red kill switch for automation. Lives in AppLayout's topbar
 * so it is reachable from every routed page. Triggerable by click OR the
 * global Ctrl/Cmd+Shift+C hotkey, regardless of focus.
 */
export function EmergencyStopButton() {
  const emergencyStop = useAutomationStore((state) => state.emergencyStop);
  const addEvent = useEventStore((state) => state.addEvent);

  const trigger = useCallback(() => {
    void emergencyStop();
    addEvent({
      id: crypto.randomUUID(),
      type: "automation.stopped",
      payload: { reason: "emergency_stop" },
      createdAt: new Date().toISOString(),
    });
  }, [emergencyStop, addEvent]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isModifiedC =
        event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
      if (isModifiedC) {
        event.preventDefault();
        trigger();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trigger]);

  return (
    <button
      type="button"
      className="emergency-stop-btn"
      onClick={trigger}
      title="Emergency Stop (Ctrl/Cmd+Shift+C)"
      aria-label="Emergency Stop"
    >
      ⛔ Emergency Stop
    </button>
  );
}
