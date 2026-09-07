/**
 * The MCP server: list the tools, call the tools.
 *
 * Deliberately thin. Everything interesting is in tools/, and the server knows
 * nothing about what any tool does — which is what lets a new tool be one entry
 * in the registry rather than a change here.
 *
 * Argument validation happens at this layer rather than inside the tools,
 * because every tool's arguments end up on a command line. A tool that rejects
 * bad input itself would still have been handed it.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const registry = require('./tools');
const { validate } = require('./lib/validate');

const SERVER_INFO = {
  name: 'scripts',
  title: 'Local scripts toolbox',
  version: '1.0.0',
};

const INSTRUCTIONS = [
  'Local batch utilities: character dataset building (game wiki + Gelbooru + merge), audio download and',
  'extraction, image and video conversion, PDF OCR, archive extraction and a few git helpers.',
  '',
  'Two things worth knowing before calling anything:',
  '',
  '1. Long tools return a job id. Scrapes and downloads take minutes. Every such tool waits a short',
  '   while and then hands back a job id — poll it with job_status, or read its output with job_logs.',
  '   The work carries on either way. Raise wait_seconds to wait longer, or set it to 0 to get an id',
  '   straight away.',
  '',
  '2. File tools take absolute paths. Pass "input" as absolute paths to files or folders and results',
  '   come back in "output_dir". Omit "input" and the tool works on its own in/ folder in the scripts',
  '   repo, which is the by-hand workflow.',
  '',
  'For a character, character_pack does audio, both image sources and the merge as one job.',
].join('\n');

/** Errors reach the model as a tool result, not a protocol error, so it can react. */
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function createServer() {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listing() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = registry.byName.get(name);

    if (!tool) {
      return errorResult(
        `No tool named "${name}". Available: ${[...registry.byName.keys()].join(', ')}.`
      );
    }

    let args;
    try {
      args = validate(tool.inputSchema, rawArgs);
    } catch (err) {
      return errorResult(`Bad arguments for ${name}: ${err.message}`);
    }

    try {
      return await tool.run(args);
    } catch (err) {
      // A thrown error is a tool that could not start — a missing input, an
      // unsupported platform, a search that found nothing. Worth the model
      // seeing verbatim, since it usually says exactly what to change.
      return errorResult(`${name} failed: ${err.message}`);
    }
  });

  return server;
}

module.exports = { createServer, SERVER_INFO, INSTRUCTIONS };
