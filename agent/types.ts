import type { GetJobInput, StoredJobSearchInput } from "./schemas";

export interface StoredJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  status: string;
  summary: string | null;
}

export interface StoredJobHandlers {
  searchStoredJobs(input: StoredJobSearchInput): Promise<ReadonlyArray<StoredJob>>;
  getJob(input: GetJobInput): Promise<StoredJob | null>;
}

export type AgentEvent =
  | {
      kind: "step";
      agentRunId: string;
      step: number;
    }
  | {
      kind: "tool";
      agentRunId: string;
      step: number;
      toolName: string;
      latencyMs: number;
      success: boolean;
      sourceCount: number;
      error?: string;
    };

export type AgentEventSink = (event: AgentEvent) => void;
