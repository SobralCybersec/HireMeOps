import { create } from "zustand";
import type { AppEvent } from "../../types/events";
import type { BrowserSessionStatus } from "../../types/domain";

interface BrowserSessionStoreState {
  statuses: Record<string, Record<string, BrowserSessionStatus>>;
  applyEvent: (event: AppEvent) => void;
  clear: () => void;
}

function isStatus(value: unknown): value is BrowserSessionStatus {
  return (
    value === "valid" ||
    value === "expired" ||
    value === "login_required" ||
    value === "challenged" ||
    value === "unknown" ||
    value === "revoked"
  );
}

export const useBrowserSessionStore = create<BrowserSessionStoreState>((set) => ({
  statuses: {},
  applyEvent: (event) => {
    if (event.type !== "browser.session.status") return;
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null) return;
    const value = payload as { platform?: unknown; status?: unknown };
    const profileId = event.profileId;
    const platform = value.platform;
    const status = value.status;
    if (!profileId || typeof platform !== "string" || !isStatus(status)) return;
    set((state) => ({
      statuses: {
        ...state.statuses,
        [profileId]: {
          ...state.statuses[profileId],
          [platform]: status,
        },
      },
    }));
  },
  clear: () => set({ statuses: {} }),
}));
