#!/usr/bin/env node
/**
 * Point another project at this server.
 *
 * An MCP server is wired into a project by a .mcp.json in its root, which is
 * two lines for the HTTP transport — the whole appeal of running one shared
 * server rather than a copy per project. This writes that file, merging into
 * whatever is already there rather than replacing it, so a project that already
 * has MCP servers configured keeps them.
 *
 *   node mcp/install.js ../my-project
 *   node mcp/install.js ../one ../two ../three
 *   node mcp/install.js ../my-project --stdio     # spawn per client instead
 *   node mcp/install.js ../my-project --check     # say what would change
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_NAME = 'scripts';
const DEFAULT_PORT = Number(process.env.SCRIPTS_MCP_PORT) || 7391;

const USAGE = `Usage: node mcp/install.js <project-dir> [more dirs...] [options]

  --stdio          Spawn this server per client instead of using the shared HTTP one.
  --name <name>    Server name inside .mcp.json. Default "${DEFAULT_NAME}".
  --port <n>       Port the HTTP server listens on. Default ${DEFAULT_PORT}.
  --check          Print what would change without writing anything.`;

function parseArgs(argv) {
  const options = { dirs: [], stdio: false, name: DEFAULT_NAME, port: DEFAULT_PORT, check: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stdio') options.stdio = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--name') options.name = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option "${arg}".\n\n${USAGE}`);
      process.exit(1);
    } else {
      options.dirs.push(arg);
    }
  }

  if (options.dirs.length === 0) {
    console.error(`Which project?\n\n${USAGE}`);
    process.exit(1);
  }
  if (!options.name) {
    console.error('--name needs a value.');
    process.exit(1);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error('--port must be a port number.');
    process.exit(1);
  }
  return options;
}

function entryFor(options) {
  if (options.stdio) {
    return {
      command: 'node',
      args: [path.join(REPO_ROOT, 'mcp', 'stdio.js')],
    };
  }
  return {
    type: 'http',
    url: `http://127.0.0.1:${options.port}/mcp`,
  };
}

function install(dir, options) {
  const projectDir = path.resolve(dir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    return { dir: projectDir, ok: false, message: 'not a directory' };
  }

  const configPath = path.join(projectDir, '.mcp.json');
  let config = { mcpServers: {} };
  let existed = false;

  if (fs.existsSync(configPath)) {
    existed = true;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      // Overwriting a config that failed to parse would throw away whatever it
      // holds; better to stop and let someone look at it.
      return { dir: projectDir, ok: false, message: `.mcp.json is not valid JSON (${err.message}) — left alone` };
    }
    if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};
  }

  const entry = entryFor(options);
  const previous = config.mcpServers[options.name];
  const unchanged = previous && JSON.stringify(previous) === JSON.stringify(entry);

  if (unchanged) {
    return { dir: projectDir, ok: true, message: `already points at ${entry.url || 'this server over stdio'}` };
  }

  config.mcpServers[options.name] = entry;

  if (options.check) {
    return {
      dir: projectDir,
      ok: true,
      message: `${previous ? 'would replace' : 'would add'} "${options.name}" in ${existed ? 'existing' : 'new'} .mcp.json`,
    };
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return {
    dir: projectDir,
    ok: true,
    message: `${previous ? 'replaced' : 'added'} "${options.name}" in ${existed ? 'existing' : 'new'} .mcp.json`,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = options.dirs.map((dir) => install(dir, options));

  for (const result of results) {
    console.log(`${result.ok ? '  ok  ' : ' fail '} ${result.dir}\n         ${result.message}`);
  }

  const failures = results.filter((result) => !result.ok).length;

  if (!options.check && failures < results.length) {
    console.log('');
    if (options.stdio) {
      console.log('Each client will spawn its own copy of the server. Nothing to keep running.');
    } else {
      console.log(`Start the shared server if it is not already up:\n\n  npm run mcp\n`);
      console.log(`Check it:\n\n  curl http://127.0.0.1:${options.port}/health\n`);
    }
    console.log('Then restart the MCP client in those projects so it reads the new config.');
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();
