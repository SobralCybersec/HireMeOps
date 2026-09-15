import { advancedSearchExa, connectExa } from "./exa";

if (Bun.env.EXA_MCP_SMOKE !== "1") {
  console.log("Exa MCP smoke skipped; set EXA_MCP_SMOKE=1 to run tools/list.");
} else {
  const connection = await connectExa({
    apiKey: Bun.env.EXA_API_KEY,
    url: Bun.env.EXA_MCP_URL,
  });

  try {
    const listed = await connection.client.listTools();
    const names = listed.tools.map((entry) => entry.name).sort();
    console.log(`Exa MCP tools/list passed: ${names.join(", ")}`);
    if (Bun.env.EXA_MCP_QUERY) {
      const result = await advancedSearchExa(connection, { query: Bun.env.EXA_MCP_QUERY });
      console.log(`Exa MCP advanced search passed: ${result.source}`);
    }
  } finally {
    await connection.close();
  }
}
