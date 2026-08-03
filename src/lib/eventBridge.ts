import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEventStore } from "../stores/useEventStore";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useJobStore } from "../stores/useJobStore";
import { useAiStatusStore, type AiPhase } from "../stores/useAiStatusStore";
import type { AppEvent } from "../types/events";
import type { AutomationState, JobPostDto } from "../types/domain";

const EVENT_CHANNEL = "hiremeops://event";

// The authoritative automation lifecycle states the backend engine can report
// via `automation.state`. Anything outside this set is ignored so a malformed
// or future payload can never wedge the cockpit into an unknown state. This set
// MUST stay complete against the `AutomationState` union in types/domain.ts -
// dropping a legitimate transition (e.g. Searching → ExtractingJob) would
// silently re-wedge the cockpit, which is the exact bug this fix removes.
const AUTOMATION_STATES: readonly AutomationState[] = [
  "Queued",
  "PreparingBrowser",
  "CheckingSession",
  "Searching",
  "ExtractingJob",
  "ScoringJob",
  "SelectingCV",
  "GeneratingAnswers",
  "FillingForm",
  "Submitting",
  "VerifyingSubmission",
  "Completed",
  "NeedsReview",
  "PausedForCaptcha",
  "PausedByUser",
  "SkippedDuplicateUrl",
  "RetryScheduled",
  "Failed",
  "Stopped",
];

/**
 * Route a backend `automation.state` event into `useAutomationStore` so the
 * cockpit follows the real engine lifecycle instead of hanging on the
 * optimistic "PreparingBrowser" ack. Payload shape (from the Rust side):
 * `{ state: "<AutomationState>", taskId?: string, detail?: string }`.
 *
 * Runs centrally in the bridge - independent of which page is mounted - so the
 * store stays authoritative even when the AutomationCockpit isn't on screen.
 */
function dispatchAutomationState(event: AppEvent): void {
  const data = event.payload;
  if (typeof data !== "object" || data === null) return;

  const raw = (data as { state?: unknown }).state;
  if (typeof raw !== "string") return;
  if (!AUTOMATION_STATES.includes(raw as AutomationState)) {
    console.warn(`[event-bridge] ignoring unknown automation state: "${raw}"`);
    return;
  }

  const taskIdRaw = (data as { taskId?: unknown }).taskId;
  const detailRaw = (data as { detail?: unknown }).detail;
  const watchUrlRaw = (data as { watchUrl?: unknown }).watchUrl;
  useAutomationStore
    .getState()
    .applyServerState(
      raw as AutomationState,
      typeof taskIdRaw === "string" ? taskIdRaw : null,
      typeof detailRaw === "string" ? detailRaw : null,
      typeof watchUrlRaw === "string" ? watchUrlRaw : null,
    );
}

/**
 * Route a `job.search.item_found` event into `useJobStore` so the Vagas list
 * grows live as a scrape runs, instead of only when the search finishes. The
 * payload is the ingested `JobPostDto`; ignore anything without a string id.
 */
function dispatchJobFound(event: AppEvent): void {
  const data = event.payload;
  if (typeof data !== "object" || data === null) return;
  const job = data as JobPostDto;
  if (typeof job.id !== "string") return;
  useJobStore.getState().upsertJob(job);
}

/**
 * Route an `ai.progress` event into `useAiStatusStore` so the UI can show a live
 * "generating…" indicator. Payload: `{ phase, scope }`. Ignores unknown phases.
 */
function dispatchAiProgress(event: AppEvent): void {
  const data = event.payload;
  if (typeof data !== "object" || data === null) return;
  const phase = (data as { phase?: unknown }).phase;
  const scope = (data as { scope?: unknown }).scope;
  if (phase !== "generating" && phase !== "ready" && phase !== "failed") return;
  useAiStatusStore.getState().set(phase as AiPhase, typeof scope === "string" ? scope : null);
}

// Backoff schedule (ms) for re-subscribe attempts if `listen` rejects - e.g. a
// transient failure during app startup before the Tauri event system is ready.
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000];

let unlisten: UnlistenFn | null = null;
// True once startEventBridge has been entered, so repeat calls are no-ops even
// while the first attempt is still mid-retry (unlisten is not yet assigned).
let started = false;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function isAppEvent(value: unknown): value is AppEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "createdAt" in value
  );
}

async function subscribe(attempt: number, expectedGeneration: number): Promise<void> {
  const { setBridgeStatus } = useEventStore.getState();
  setBridgeStatus("connecting");

  try {
    const listener = await listen<unknown>(EVENT_CHANNEL, (event) => {
      const payload = event.payload;

      if (isAppEvent(payload)) {
        useEventStore.getState().addEvent(payload);
        if (payload.type === "automation.state") {
          dispatchAutomationState(payload);
        } else if (payload.type === "job.search.item_found") {
          dispatchJobFound(payload);
        } else if (payload.type === "ai.progress") {
          dispatchAiProgress(payload);
        }
        return;
      }

      // Backend sent something that doesn't match the AppEvent contract yet
      // (e.g. before the Rust side is wired up). Surface it as a raw log
      // event instead of dropping it silently.
      useEventStore.getState().addEvent({
        id: crypto.randomUUID(),
        type: "log",
        payload,
        createdAt: new Date().toISOString(),
      });
    });

    // If we were torn down while awaiting `listen`, immediately detach so we
    // don't leak a live subscription past stopEventBridge.
    if (!started || generation !== expectedGeneration) {
      listener();
      return;
    }
    unlisten?.();
    unlisten = listener;
    useEventStore.getState().setBridgeStatus("live");
  } catch (error) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (!started || generation !== expectedGeneration) return;
    if (delay === undefined) {
      console.error(`[event-bridge] failed to subscribe to "${EVENT_CHANNEL}"; giving up`, error);
      useEventStore.getState().setBridgeStatus("error");
      return;
    }
    console.warn(
      `[event-bridge] subscribe attempt ${attempt + 1} failed; retrying in ${delay}ms`,
      error,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void subscribe(attempt + 1, expectedGeneration);
    }, delay);
  }
}

/**
 * Subscribes once to the "hiremeops://event" Tauri event channel and pipes
 * every payload into useEventStore. This is the ONLY live-data source for the
 * UI - no polling. Safe to call multiple times (no-op after the first). If the
 * initial subscribe fails it retries with backoff, reporting health via
 * useEventStore.bridgeStatus.
 */
export async function startEventBridge(): Promise<void> {
  if (started) return;
  started = true;
  generation += 1;
  await subscribe(0, generation);
}

export function stopEventBridge(): void {
  started = false;
  generation += 1;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  useEventStore.getState().setBridgeStatus("connecting");
}
