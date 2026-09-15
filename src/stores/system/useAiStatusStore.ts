import { create } from "zustand";

/** Coarse live AI activity phase, fed by `ai.progress` events (lib/eventBridge.ts).
 *  "generating" while a completion is in flight; "ready"/"failed" when it lands. */
export type AiPhase = "idle" | "generating" | "ready" | "failed";

interface AiStatusState {
  phase: AiPhase;
  /** Which AI task is running (e.g. "application_draft"), or null when idle. */
  scope: string | null;
  set: (phase: AiPhase, scope: string | null) => void;
}

export const useAiStatusStore = create<AiStatusState>((set) => ({
  phase: "idle",
  scope: null,
  set: (phase, scope) => set({ phase, scope }),
}));
