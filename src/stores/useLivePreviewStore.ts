import { create } from "zustand";

/**
 * Global live-preview pane visibility. One shared Evidence-Viewer pane (mounted once in AppLayout)
 * attaches to the driver's CURRENT automation session, so ANY running automation — auto-connect,
 * InfoJobs/Catho apply, searches, resume fills — can be watched from any page, not just the
 * LinkedIn Easy Apply screen. Persisted so it survives navigation.
 */
const KEY = "hiremeops-livepreview-open";

interface LivePreviewState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useLivePreviewStore = create<LivePreviewState>((set, get) => ({
  open: typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1",
  setOpen: (open) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, open ? "1" : "0");
    set({ open });
  },
  toggle: () => get().setOpen(!get().open),
}));
