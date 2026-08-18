import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { safeInvoke } from "../../lib/tauriInvoke";
import type { DockerStatus } from "../../types/domain";

/** Dot colour keyed to how ready the container runtime is. */
function tone(s: DockerStatus): string {
  if (s.optIn && s.imageBuilt) return "var(--color-status-running-text, #4ade80)";
  if (s.daemonRunning) return "var(--color-accent, #c8c8c8)";
  if (s.installed) return "var(--color-warning, #fbbf24)";
  return "var(--color-text-muted, #858585)";
}

/**
 * Read-only environment check for the OPTIONAL containerized worker. The worker
 * runs on the host by default; this panel just tells you whether Docker is
 * available and how to switch the worker into a container (build the image, then
 * set HIREMEOPS_USE_DOCKER=1). No toggle — enabling is an env var by design, so a
 * headless/CI run and the app agree on the same switch.
 */
export function DockerStatusPanel() {
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const s = await safeInvoke<DockerStatus>("docker_status");
    if (s) setStatus(s);
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div>
      <p
        style={{
          margin: 0,
          marginBottom: "var(--sp-4)",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          lineHeight: 1.5,
        }}
      >
        The browser worker runs on the host by default. With Docker you can run it in a reproducible
        container instead (Node + patchright + Chromium + Xvfb, all baked in). Build the image with{" "}
        <code className="code">npm run build:docker</code>, then set{" "}
        <code className="code">HIREMEOPS_USE_DOCKER=1</code> before launching to switch the worker
        into it. It runs <em>headed under Xvfb</em> and NATs out through your own IP — same stealth
        posture as the host path.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          padding: "var(--sp-3)",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            flexShrink: 0,
            background: status ? tone(status) : "var(--color-text-muted)",
          }}
        />
        <span style={{ flex: 1, fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
          {status ? status.summary : checking ? "Checking Docker…" : "Docker status unknown."}
          {status?.serverVersion && (
            <span style={{ color: "var(--color-text-muted)" }}>
              {" "}
              (engine {status.serverVersion})
            </span>
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : "Recheck"}
        </Button>
      </div>
    </div>
  );
}
