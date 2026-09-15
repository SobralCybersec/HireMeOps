import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { errMessage, invokeStrict, safeInvoke } from "../../lib/tauri/tauriInvoke";
import type { BrowserSessionMetadata, BrowserSessionStatus } from "../../types/domain";

const PLATFORMS = [
  ["linkedin", "LinkedIn"],
  ["indeed", "Indeed"],
  ["gupy", "Gupy"],
  ["catho", "Catho"],
  ["infojobs", "InfoJobs"],
] as const;

type LoginCheck = {
  status?: Record<string, boolean>;
  platform_status?: Record<string, BrowserSessionStatus>;
};

function sessionStatusLabel(status: BrowserSessionStatus | undefined): string {
  if (status === "valid") return "Connected";
  if (status === "login_required") return "Login required";
  if (status === "challenged") return "Challenge";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  return "Unknown";
}

function statusClass(status: BrowserSessionStatus | undefined): string {
  return `cc-session-status cc-session-status--${status ?? "unknown"}`;
}

function syncedLabel(value: string): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? `Synced ${new Date(time).toLocaleString()}` : "Synced";
}

function localPlatformStatus(checked: LoginCheck): Record<string, BrowserSessionStatus> {
  return (checked.platform_status ??
    Object.fromEntries(
      Object.entries(checked.status ?? {}).map(([platform, valid]) => [
        platform,
        valid ? "valid" : "login_required",
      ]),
    )) as Record<string, BrowserSessionStatus>;
}

async function runSessionAction(
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  action: () => Promise<void>,
) {
  setBusy(true);
  setError(null);
  try {
    await action();
  } catch (reason) {
    setError(errMessage(reason));
  } finally {
    setBusy(false);
  }
}

function useCloudSession(profileId: string | null) {
  const [metadata, setMetadata] = useState<BrowserSessionMetadata | null>(null);
  const [localStatus, setLocalStatus] = useState<Record<string, BrowserSessionStatus>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) {
      setMetadata(null);
      setLocalStatus({});
      return;
    }
    const value = await safeInvoke<BrowserSessionMetadata | null>("browser_session_status", {
      profileId,
    });
    setMetadata(value);
    setLocalStatus(value?.platformStatus ?? {});
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback(async () => {
    if (!profileId) return;
    await runSessionAction(setBusy, setError, async () => {
      const checked = await invokeStrict<LoginCheck>("check_all_logins", { profileId });
      setLocalStatus(localPlatformStatus(checked));
    });
  }, [profileId]);

  const sync = useCallback(async () => {
    if (!profileId) return;
    await runSessionAction(setBusy, setError, async () => {
      const value = await invokeStrict<BrowserSessionMetadata>("sync_browser_session", {
        profileId,
      });
      setMetadata(value);
      setLocalStatus(value.platformStatus);
    });
  }, [profileId]);

  const revoke = useCallback(async () => {
    if (!profileId || !metadata) return;
    await runSessionAction(setBusy, setError, async () => {
      const value = await invokeStrict<BrowserSessionMetadata | null>("revoke_browser_session", {
        profileId,
      });
      setMetadata(value);
      setLocalStatus(value?.platformStatus ?? {});
    });
  }, [metadata, profileId]);

  return { metadata, localStatus, busy, error, check, sync, revoke };
}

export function CloudSessionPanel({ profileId }: { profileId: string | null }) {
  const { metadata, localStatus, busy, error, check, sync, revoke } = useCloudSession(profileId);

  const status = localStatus;
  return (
    <section className="cc-session-panel" aria-labelledby="cloud-session-title">
      <SessionHeader metadata={metadata} />
      <SessionPlatforms status={status} />
      <SessionActions
        profileId={profileId}
        metadata={metadata}
        busy={busy}
        check={check}
        sync={sync}
        revoke={revoke}
      />
      <SessionFooter metadata={metadata} error={error} />
    </section>
  );
}

function SessionHeader({ metadata }: { metadata: BrowserSessionMetadata | null }) {
  return (
    <div className="cc-session-panel__head">
      <div>
        <span className="cc-session-panel__eyebrow">Session bridge</span>
        <h3 id="cloud-session-title">Cloud session</h3>
      </div>
      <span className={statusClass(metadata?.status)}>
        {metadata ? sessionStatusLabel(metadata.status) : "Not synchronized"}
      </span>
    </div>
  );
}

function SessionPlatforms({ status }: { status: Record<string, BrowserSessionStatus> }) {
  return (
    <div className="cc-session-platforms">
      {PLATFORMS.map(([key, label]) => (
        <div className="cc-session-platform" key={key}>
          <span>{label}</span>
          <strong className={statusClass(status[key])}>{sessionStatusLabel(status[key])}</strong>
        </div>
      ))}
    </div>
  );
}

type SessionActionsProps = {
  profileId: string | null;
  metadata: BrowserSessionMetadata | null;
  busy: boolean;
  check: () => Promise<void>;
  sync: () => Promise<void>;
  revoke: () => Promise<void>;
};

function SessionActions({ profileId, metadata, busy, check, sync, revoke }: SessionActionsProps) {
  return (
    <div className="cc-session-panel__actions">
      <Button variant="ghost" size="sm" onClick={() => void check()} disabled={busy || !profileId}>
        {busy ? "Working…" : "Check sessions"}
      </Button>
      <Button variant="primary" size="sm" onClick={() => void sync()} disabled={busy || !profileId}>
        Sync to cloud
      </Button>
      {metadata && (
        <Button variant="danger" size="sm" onClick={() => void revoke()} disabled={busy}>
          Revoke
        </Button>
      )}
    </div>
  );
}

function SessionFooter({
  metadata,
  error,
}: {
  metadata: BrowserSessionMetadata | null;
  error: string | null;
}) {
  return (
    <>
      <p className="cc-zone__muted" aria-live="polite">
        {metadata ? syncedLabel(metadata.updatedAt) : "Local login state is not synchronized."}
        {metadata ? ` · revision ${metadata.revision}` : ""}
      </p>
      {error && (
        <p className="cc-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
