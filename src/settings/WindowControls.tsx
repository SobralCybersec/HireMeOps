import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./platform";

/**
 * Close-only window control bar for the settings window.
 * The settings window is always close-only — no min/max.
 * Returns null when running outside Tauri (browser preview).
 */
export function WindowControls() {
  if (!USE_CUSTOM_WINDOW_CONTROLS) return null;

  const w = getCurrentWindow();

  return (
    <div className="flex h-full shrink-0 items-center pr-1">
      <CtlButton ariaLabel="Close" onClick={() => void w.close()} danger>
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
      </CtlButton>
    </div>
  );
}

function CtlButton({
  ariaLabel,
  onClick,
  children,
  danger,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors",
        danger
          ? "hover:bg-destructive/15 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
