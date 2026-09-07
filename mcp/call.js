#!/usr/bin/env node
/**
 * Call one tool on the running HTTP server, from a terminal.
 *
 *   node mcp/call.js dataset_list '{"character":"shadowheart"}'
 *   node mcp/call.js job_status '{"job":"..."}'
 *
 * Useful for trying a tool by hand, and for checking the server is answering
 * before wiring a project up to it.
 */

const URL_ = process.env.SCRIPTS_MCP_URL || 'http://127.0.0.1:7391/mcp';

async function main() {
  const [name, rawArgs] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: node mcp/call.js <tool> [json-arguments]');
    console.error("Example: node mcp/call.js dataset_list '{\"character\":\"shadowheart\"}'");
    process.exit(1);
  }

  let args = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch (err) {
      console.error(`Arguments must be JSON: ${err.message}`);
      process.exit(1);
    }
  }

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const client = new Client({ name: 'call', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

  if (name === 'list') {
    const { tools } = await client.listTools();
    for (const tool of tools) console.log(`${tool.name}\n    ${tool.title}`);
    process.exit(0);
  }

  const result = await client.callTool({ name, arguments: args });
  for (const part of result.content || []) {
    if (part.type === 'text') console.log(part.text);
  }
  process.exit(result.isError ? 1 : 0);
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
