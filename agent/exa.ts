import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { z } from "zod";
import { asUntrustedWebResult, type UntrustedWebResult } from "./untrusted";

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const EXA_TOOLS = ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"] as const;

const advancedSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  numResults: z.number().int().min(1).max(25).default(10),
  category: z.string().trim().min(1).max(100).optional(),
  includeDomains: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
  startPublishedDate: z.string().datetime({ offset: true }).optional(),
  endPublishedDate: z.string().datetime({ offset: true }).optional(),
});

export type AdvancedSearchInput = z.infer<typeof advancedSearchInputSchema>;

export interface ExaConnection {
  client: MCPClient;
  tools: ToolSet;
  close: () => Promise<void>;
}

export function exaUrl(baseUrl = EXA_MCP_URL): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("exaApiKey");
  url.searchParams.delete("apiKey");
  url.searchParams.set("tools", EXA_TOOLS.join(","));
  return url.toString();
}

export async function advancedSearchExa(
  connection: ExaConnection,
  input: unknown,
): Promise<UntrustedWebResult> {
  const request = advancedSearchInputSchema.parse(input);
  if (!Object.hasOwn(connection.tools, "web_search_advanced_exa")) {
    throw new Error("Exa advanced search tool was not offered by the server");
  }

  const response = await connection.client.callTool({
    name: "web_search_advanced_exa",
    arguments: request,
  });
  return asUntrustedWebResult("exa:web_search_advanced_exa", JSON.stringify(response.content));
}

export async function connectExa(
  options: { apiKey?: string; url?: string } = {},
): Promise<ExaConnection> {
  const headers = options.apiKey ? { "x-api-key": options.apiKey } : undefined;
  const client = await createMCPClient({
    clientName: "hiremeops-agent",
    version: "0.1.0",
    protocolVersionDiscovery: true,
    maxRetries: 0,
    transport: { type: "http", url: exaUrl(options.url), headers },
  });
  const available = await client.tools();
  const tools = Object.fromEntries(
    Object.entries(available).filter(([name]) =>
      EXA_TOOLS.includes(name as (typeof EXA_TOOLS)[number]),
    ),
  ) as ToolSet;
  return { client, tools: wrapUntrustedTools(tools), close: () => client.close() };
}

function wrapUntrustedTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute as unknown as (
        input: unknown,
        options: unknown,
      ) => PromiseLike<unknown> | unknown;
      return [
        name,
        {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            const result = await execute(input, options);
            return asUntrustedWebResult(`exa:${name}`, JSON.stringify(result) ?? String(result));
          },
        },
      ];
    }),
  ) as ToolSet;
}
