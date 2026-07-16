import { useCallback, useEffect } from "react";
import { StopIcon } from "@hugeicons/core-free-icons";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import { Icon } from "./ui";

interface EmergencyStopButtonProps {
  /** Icon-only affordance for the collapsed sidebar rail. */
  compact?: boolean;
}

/**
 * Always-visible kill switch pinned in the sidebar footer.
 * Triggered by click OR Ctrl/Cmd+Shift+S from any focus position.
 *
 * ponytail: intentionally NOT the Button primitive - E-STOP has a bespoke
 * uppercase danger-fill pill (`.emergency-stop-btn` in theme.css) that doesn't
 * map to `.btn--danger` (which is a hover-fill outline). Report to Lane 1:
 * a "danger-emphasis" Button variant would let this move to the primitive.
 */
export function EmergencyStopButton({ compact = false }: EmergencyStopButtonProps) {
  const emergencyStop = useAutomationStore((s) => s.emergencyStop);
  const addEvent = useEventStore((s) => s.addEvent);

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
    function onKeyDown(e: KeyboardEvent) {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        trigger();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trigger]);

  const cls = compact ? "emergency-stop-btn emergency-stop-btn--compact" : "emergency-stop-btn";

  return (
    <button
      type="button"
      className={cls}
      onClick={trigger}
      title="Emergency Stop (Ctrl/Cmd+Shift+S)"
      aria-label="Emergency Stop - abort automation immediately"
      aria-keyshortcuts="Control+Shift+S Meta+Shift+S"
    >
      <Icon icon={StopIcon} size={14} />
      {!compact && <span>E-STOP</span>}
    </button>
  );
}
