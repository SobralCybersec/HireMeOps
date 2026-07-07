import { useCallback, useEffect } from "react";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";

/**
 * Always-visible kill switch in the top command bar.
 * Triggered by click OR Ctrl/Cmd+Shift+S from any focus position.
 * Preserves original store wiring exactly; only the visual changes.
 */
export function EmergencyStopButton() {
  const emergencyStop = useAutomationStore((s) => s.emergencyStop);
  const addEvent      = useEventStore((s) => s.addEvent);

  const trigger = useCallback(() => {
    void emergencyStop();
    addEvent({
      id:        crypto.randomUUID(),
      type:      "automation.stopped",
      payload:   { reason: "emergency_stop" },
      createdAt: new Date().toISOString(),
    });
  }, [emergencyStop, addEvent]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
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
      title="Emergency Stop (Ctrl/Cmd+Shift+S)"
      aria-label="Emergency Stop – abort automation immediately"
    >
      ■ E-STOP
    </button>
  );
}
