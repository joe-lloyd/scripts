/**
 * The tool registry.
 *
 * Every tool is a plain object: name, description, a JSON Schema for its
 * arguments, MCP annotations, and a run(args) that returns a tool result. The
 * server does not know what any of them do — it lists them and calls them.
 */

const datasets = require('./datasets');
const media = require('./media');
const files = require('./files');
const jobTools = require('./jobs');

const TOOLS = [...datasets, ...media, ...files, ...jobTools];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

// A duplicate name would silently shadow a tool, so fail loudly at load time.
if (byName.size !== TOOLS.length) {
  const seen = new Set();
  const duplicates = TOOLS.map((tool) => tool.name).filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  throw new Error(`Duplicate tool name(s) in the registry: ${[...new Set(duplicates)].join(', ')}`);
}

/** The shape the MCP tools/list response wants. */
function listing() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  }));
}

module.exports = { TOOLS, byName, listing };
