import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

export const MCP_INITIALIZATION_TIMEOUT_MS = 5_000;
export const MCP_TOOL_CALL_TIMEOUT_MS = 30_000;

/** HTTP MCP config only. Credentials stay in a backend-owned fetch adapter. */
export interface McpServerConfig {
  id: string;
  url: string;
}

export interface McpToolRegistry {
  tools: Record<string, unknown>;
  connectedServers: string[];
  close: () => Promise<void>;
}

type ExecutableTool = {
  execute?: (...args: unknown[]) => Promise<unknown>;
};

function namespacedToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp_${safeServer}_${safeTool}`;
}

function withTimeout<T extends Record<string, unknown>>(tools: T, timeoutMs: number): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const candidate = tool as ExecutableTool | null;
      if (!candidate || typeof candidate.execute !== "function") return [name, tool];
      const execute = candidate.execute.bind(candidate);
      return [
        name,
        {
          ...candidate,
          execute: (...args: unknown[]) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`MCP tool "${name}" timed out`)),
                timeoutMs,
              );
            });
            return Promise.race([execute(...args), timeout]).finally(() => {
              if (timer !== undefined) clearTimeout(timer);
            });
          },
        },
      ];
    }),
  ) as T;
}

/**
 * Discover AI SDK tools from configured HTTP MCP servers.
 * Call `close` after the model turn; partial setup is closed on failure.
 */
export async function connectMcpServers(
  servers: McpServerConfig[],
  fetchFn: typeof fetch = fetch,
): Promise<McpToolRegistry> {
  const clients: MCPClient[] = [];
  const tools: Record<string, unknown> = {};

  try {
    for (const server of servers) {
      if (!server.url.trim()) continue;
      const client = await createMCPClient({
        clientName: "hiremeops",
        maxRetries: 0,
        initializationOptions: { timeout: MCP_INITIALIZATION_TIMEOUT_MS },
        transport: {
          type: "http",
          url: server.url,
          redirect: "error",
          fetch: fetchFn,
          terminateSessionOnClose: true,
        },
      });
      clients.push(client);
      const discovered = await client.tools();
      for (const [name, tool] of Object.entries(discovered)) {
        const key = namespacedToolName(server.id, name);
        if (key in tools) throw new Error(`MCP tool name collision: ${key}`);
        tools[key] = withTimeout({ [key]: tool }, MCP_TOOL_CALL_TIMEOUT_MS)[key];
      }
    }
  } catch (error) {
    await Promise.allSettled(clients.map((client) => client.close()));
    throw error;
  }

  let closed = false;
  return {
    tools,
    connectedServers: clients.map((client) => client.serverInfo.name),
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}
