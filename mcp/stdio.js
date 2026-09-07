#!/usr/bin/env node
/**
 * Stdio entry point — the same tools, spawned per client instead of shared.
 *
 * The HTTP server is the better arrangement for everyday use: one process, one
 * URL, jobs visible across projects. This exists for the cases where a
 * long-running background process is the wrong shape — a CI run, a throwaway
 * container, a machine where nothing should be listening on a port.
 *
 * The tradeoff is that the client owns the process: when it exits, any child
 * still running dies with it. Jobs survive on disk and will report themselves
 * as orphaned, but a scrape killed halfway is still a scrape killed halfway.
 * Prefer http.js for anything that takes minutes.
 *
 *   node mcp/stdio.js
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createServer } = require('./server');

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout belongs to the protocol from here on; anything logged goes to stderr.
  process.stderr.write('[scripts-mcp] ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[scripts-mcp] failed to start: ${err.stack || err.message}\n`);
  process.exit(1);
});
