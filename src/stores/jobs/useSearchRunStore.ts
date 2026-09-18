import { create } from "zustand";
import type { AppEvent } from "../../types/events";

export type SearchRunPhase =
  | "queued"
  | "validating_session"
  | "launching_browser"
  | "navigating"
  | "discovering"
  | "enriching"
  | "persisting"
  | "syncing_session"
  | "completed"
  | "failed"
  | "cancelled";

export interface SearchRunView {
  id: string;
  profileId: string | null;
  platform: string | null;
  origin: "local" | "cloud";
  phase: SearchRunPhase;
  discovered: number;
  persisted: number;
  enriched: number;
  pages: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  lastSeq: number;
}

interface SearchRunStoreState {
  runs: Record<string, SearchRunView>;
  applyEvent: (event: AppEvent) => void;
  register: (run: Pick<SearchRunView, "id" | "profileId" | "platform" | "origin">) => void;
  clear: () => void;
}

const TERMINAL_PHASES = new Set<SearchRunPhase>(["completed", "failed", "cancelled"]);
const VALID_PHASES = new Set<SearchRunPhase>([
  "queued",
  "validating_session",
  "launching_browser",
  "navigating",
  "discovering",
  "enriching",
  "persisting",
  "syncing_session",
  "completed",
  "failed",
  "cancelled",
]);

function objectPayload(event: AppEvent): Record<string, unknown> | null {
  return typeof event.payload === "object" && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function phase(value: unknown): SearchRunPhase | null {
  return typeof value === "string" && VALID_PHASES.has(value as SearchRunPhase)
    ? (value as SearchRunPhase)
    : null;
}

function createRun(event: AppEvent, payload: Record<string, unknown>): SearchRunView {
  const now = event.createdAt;
  return {
    id: text(payload.runId) ?? "",
    profileId: text(payload.profileId) ?? event.profileId ?? null,
    platform: text(payload.platform),
    origin: payload.origin === "local" ? "local" : "cloud",
    phase: phase(payload.phase) ?? "queued",
    discovered: number(payload.discovered, 0),
    persisted: number(payload.persisted, 0),
    enriched: number(payload.enriched, 0),
    pages: number(payload.pages, 0),
    error: text(payload.error),
    startedAt: now,
    updatedAt: now,
    lastSeq: number(payload.seq, 0),
  };
}

export const useSearchRunStore = create<SearchRunStoreState>((set) => ({
  runs: {},
  register: (run) =>
    set((state) => ({
      runs: {
        ...state.runs,
        [run.id]: state.runs[run.id] ?? {
          ...run,
          phase: "queued",
          discovered: 0,
          persisted: 0,
          enriched: 0,
          pages: 0,
          error: null,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSeq: 0,
        },
      },
    })),
  applyEvent: (event) => {
    const payload = objectPayload(event);
    if (!payload) return;
    const runId = text(payload.runId);
    if (!runId) return;
    set((state) => {
      const existing = state.runs[runId];
      const current = existing ?? createRun(event, payload);
      const seq = number(payload.seq, 0);
      if (existing && seq > 0 && seq <= current.lastSeq) return state;
      const nextPhase = phase(payload.phase);
      const next: SearchRunView = {
        ...current,
        profileId: text(payload.profileId) ?? current.profileId ?? event.profileId ?? null,
        platform: text(payload.platform) ?? current.platform,
        phase: nextPhase ?? current.phase,
        discovered: number(payload.discovered, current.discovered),
        persisted: number(payload.persisted, current.persisted),
        enriched: number(payload.enriched, current.enriched),
        pages: number(payload.pages, current.pages),
        error: text(payload.error) ?? current.error,
        updatedAt: event.createdAt,
        lastSeq: Math.max(current.lastSeq, seq),
      };
      if (event.type === "job.search.completed") next.phase = "completed";
      if (event.type === "job.search.failed") next.phase = "failed";
      return { runs: { ...state.runs, [runId]: next } };
    });
  },
  clear: () => set({ runs: {} }),
}));

export function isSearchRunActive(run: SearchRunView | null | undefined): boolean {
  return Boolean(run && !TERMINAL_PHASES.has(run.phase));
}
