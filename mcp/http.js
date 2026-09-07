#!/usr/bin/env node
/**
 * Stateless Streamable HTTP entry point.
 *
 * One server on localhost that every project can point at, rather than a copy
 * of this repo spawned per project. Stateless in the protocol sense: no session
 * id, no server-side conversation state, every POST /mcp self-contained. A
 * fresh Server and transport are built per request and thrown away after it,
 * which is the pattern the spec's stateless mode describes, and it means a
 * restart never strands a client mid-session — the next request just works.
 *
 * What state there is lives on disk in .jobs/, so a scrape started through one
 * project's client can be polled from another's.
 *
 *   node mcp/http.js                 # 127.0.0.1:7391
 *   SCRIPTS_MCP_PORT=8080 node mcp/http.js
 *
 * Bound to loopback. These tools run arbitrary local scripts and delete files,
 * so binding anywhere else would hand that to the network.
 */

const http = require('http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { createServer, SERVER_INFO } = require('./server');
const registry = require('./tools');
const jobs = require('./lib/jobs');

const PORT = Number(process.env.SCRIPTS_MCP_PORT) || 7391;
const HOST = process.env.SCRIPTS_MCP_HOST || '127.0.0.1';
const MCP_PATH = '/mcp';

/**
 * A browser on this machine can otherwise be talked into posting here by a
 * page it visits. Pinning Host and Origin costs nothing and closes that.
 */
function rebindingGuards() {
  const hosts = [`${HOST}:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT}`];
  return {
    enableDnsRebindingProtection: true,
    allowedHosts: [...new Set(hosts)],
    allowedOrigins: [...new Set(hosts.flatMap((host) => [`http://${host}`, `https://${host}`]))],
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function handleMcp(req, res) {
  // Per-request server and transport: nothing survives the response, which is
  // what makes this stateless rather than merely session-free.
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    ...rebindingGuards(),
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    process.stderr.write(`[scripts-mcp] request failed: ${err.stack || err.message}\n`);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: `Internal server error: ${err.message}` },
        id: null,
      });
    }
  }
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === MCP_PATH) {
    handleMcp(req, res);
    return;
  }

  // Not part of MCP — just a way to check the server is up and see what it
  // offers without speaking the protocol.
  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      server: SERVER_INFO,
      transport: 'streamable-http (stateless)',
      endpoint: `http://${HOST}:${PORT}${MCP_PATH}`,
      tools: registry.TOOLS.length,
      running_jobs: jobs.list({ limit: 100, state: 'running' }).length,
    });
    return;
  }

  sendJson(res, 404, { error: `Not found. MCP is at ${MCP_PATH}; there is a status page at /health.` });
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(
      `[scripts-mcp] port ${PORT} is already in use — the server may already be running. ` +
        `Check with: curl http://${HOST}:${PORT}/health\n`
    );
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, HOST, () => {
  process.stdout.write(
    `[scripts-mcp] ${registry.TOOLS.length} tools on http://${HOST}:${PORT}${MCP_PATH} (stateless streamable HTTP)\n` +
      `[scripts-mcp] status: http://${HOST}:${PORT}/health\n`
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
    // A running child would otherwise hold the process open past the close.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
