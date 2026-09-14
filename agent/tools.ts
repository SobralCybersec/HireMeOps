import { tool, type ToolSet } from "ai";
import { getJobInputSchema, storedJobSearchInputSchema } from "./schemas";
import type { AgentEventSink, StoredJobHandlers } from "./types";

interface ToolOptions {
  agentRunId: string;
  getStep: () => number;
  handlers: StoredJobHandlers;
  onEvent?: AgentEventSink;
}

async function observe<T>(
  name: string,
  options: ToolOptions,
  execute: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await execute();
    options.onEvent?.({
      kind: "tool",
      agentRunId: options.agentRunId,
      step: options.getStep(),
      toolName: name,
      latencyMs: Math.round(performance.now() - started),
      success: true,
      sourceCount: Array.isArray(result) ? result.length : result ? 1 : 0,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onEvent?.({
      kind: "tool",
      agentRunId: options.agentRunId,
      step: options.getStep(),
      toolName: name,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      sourceCount: 0,
      error: message,
    });
    throw error instanceof Error ? error : new Error(message);
  }
}

export function createInternalTools(options: ToolOptions) {
  return {
    searchStoredJobs: tool({
      description: "Search the stored job corpus. Hard filters are enforced by the backend.",
      inputSchema: storedJobSearchInputSchema,
      strict: true,
      execute: (input) =>
        observe("searchStoredJobs", options, () => options.handlers.searchStoredJobs(input)),
    }),
    getJob: tool({
      description: "Read one stored job by id. Returns null when it is not visible to this caller.",
      inputSchema: getJobInputSchema,
      strict: true,
      execute: (input) => observe("getJob", options, () => options.handlers.getJob(input)),
    }),
  } satisfies ToolSet;
}
