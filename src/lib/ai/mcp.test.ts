import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectMcpServers } from "./mcp";

const mcpMock = vi.hoisted(() => ({ createMCPClient: vi.fn() }));
vi.mock("@ai-sdk/mcp", () => mcpMock);

describe("connectMcpServers", () => {
  beforeEach(() => mcpMock.createMCPClient.mockReset());

  it("namespaces discovered tools and closes clients once", async () => {
    const close = vi.fn(async () => undefined);
    const execute = vi.fn(async () => "done");
    mcpMock.createMCPClient.mockResolvedValue({
      serverInfo: { name: "MCP docs" },
      tools: async () => ({ search: { execute } }),
      close,
    });

    const registry = await connectMcpServers([{ id: "docs", url: "https://mcp.test" }]);
    expect(Object.keys(registry.tools)).toEqual(["mcp_docs_search"]);
    await (
      registry.tools.mcp_docs_search as { execute: (input: unknown) => Promise<unknown> }
    ).execute({ q: "hire" });
    await registry.close();
    await registry.close();

    expect(execute).toHaveBeenCalledWith({ q: "hire" });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.connectedServers).toEqual(["MCP docs"]);
  });

  it("cleans up clients when later discovery fails", async () => {
    const close = vi.fn(async () => undefined);
    mcpMock.createMCPClient
      .mockResolvedValueOnce({
        serverInfo: { name: "first" },
        tools: async () => ({}),
        close,
      })
      .mockRejectedValueOnce(new Error("offline"));

    await expect(
      connectMcpServers([
        { id: "first", url: "https://first.test" },
        { id: "second", url: "https://second.test" },
      ]),
    ).rejects.toThrow("offline");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects tool name collisions", async () => {
    const close = vi.fn(async () => undefined);
    mcpMock.createMCPClient.mockResolvedValue({
      serverInfo: { name: "same" },
      tools: async () => ({ search: { execute: async () => "done" } }),
      close,
    });

    await expect(
      connectMcpServers([
        { id: "docs", url: "https://first.test" },
        { id: "docs", url: "https://second.test" },
      ]),
    ).rejects.toThrow("MCP tool name collision");
    expect(close).toHaveBeenCalledTimes(2);
  });
});
