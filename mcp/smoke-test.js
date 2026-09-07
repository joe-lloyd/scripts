#!/usr/bin/env node
/**
 * Drive the running HTTP server with a real MCP client.
 *
 * Checks the things that are easy to get subtly wrong and hard to notice: that
 * the transport really is stateless (a second client with no shared session
 * gets the same answers), that every tool's schema survives a tools/list, that
 * argument validation rejects what it should, and that a tool that actually
 * touches the filesystem does what it says.
 *
 *   node mcp/http.js &
 *   node mcp/smoke-test.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const URL_ = process.env.SCRIPTS_MCP_URL || 'http://127.0.0.1:7391/mcp';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A fresh client each time, which is the point of a stateless server. */
async function connect() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));
  return client;
}

function textOf(result) {
  return (result.content || []).map((part) => part.text || '').join('\n');
}

function jsonOf(result) {
  const match = textOf(result).match(/```json\n([\s\S]*?)\n```/);
  return match ? JSON.parse(match[1]) : null;
}

async function main() {
  console.log(`Driving ${URL_}\n`);

  // ---- tools/list --------------------------------------------------------
  console.log('tools/list');
  const client = await connect();
  const { tools } = await client.listTools();
  check('lists tools', tools.length >= 25, `got ${tools.length}`);
  check(
    'every tool has a description and an object schema',
    tools.every((tool) => tool.description && tool.inputSchema && tool.inputSchema.type === 'object'),
    tools.filter((tool) => !tool.description).map((tool) => tool.name).join(', ')
  );
  check(
    'the composite tool is present',
    tools.some((tool) => tool.name === 'character_pack')
  );
  check(
    'destructive tools are annotated as such',
    tools.find((tool) => tool.name === 'remove_artifacts').annotations.destructiveHint === true
  );
  check(
    'read-only tools are annotated as such',
    tools.find((tool) => tool.name === 'dataset_list').annotations.readOnlyHint === true
  );

  // ---- statelessness -----------------------------------------------------
  console.log('\nstatelessness');
  const second = await connect();
  const secondList = await second.listTools();
  check('a second independent client sees the same tools', secondList.tools.length === tools.length);

  const raw = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1.0.0' },
      },
    }),
  });
  check('initialize returns no session id header', !raw.headers.get('mcp-session-id'), raw.headers.get('mcp-session-id'));
  check('initialize succeeds', raw.status === 200, `status ${raw.status}`);

  // ---- argument validation -----------------------------------------------
  console.log('\nargument validation');
  const missing = await client.callTool({ name: 'scrape_wiki', arguments: { wiki: 'bg3.wiki' } });
  check('rejects a missing required argument', missing.isError === true && /page is required/.test(textOf(missing)), textOf(missing).slice(0, 120));

  const badEnum = await client.callTool({ name: 'scrape_booru', arguments: { tag: 'x', rating: 'nonsense' } });
  check('rejects a value outside an enum', badEnum.isError === true && /must be one of/.test(textOf(badEnum)));

  const unknownArg = await client.callTool({ name: 'dataset_list', arguments: { nope: 1 } });
  check('rejects an unknown argument', unknownArg.isError === true && /unknown argument/.test(textOf(unknownArg)));

  const unknownTool = await client.callTool({ name: 'no_such_tool', arguments: {} });
  check('rejects an unknown tool by name', unknownTool.isError === true);

  const badGuard = await client.callTool({
    name: 'remove_artifacts',
    arguments: { directory: os.tmpdir(), confirm: 'yes' },
  });
  check('the destructive tool refuses the wrong confirmation', badGuard.isError === true, textOf(badGuard).slice(0, 100));

  const badResize = await client.callTool({ name: 'resize_img', arguments: { width: 100, scale: 50 } });
  check('resize refuses two conflicting dimensions', badResize.isError === true, textOf(badResize).slice(0, 100));

  // ---- a read-only tool over real data -----------------------------------
  console.log('\ndataset_list against real data');
  const all = await client.callTool({ name: 'dataset_list', arguments: {} });
  const allData = jsonOf(all);
  check('returns datasets', allData && allData.datasets.length > 0, `${allData && allData.datasets.length}`);
  check('counts images', allData && allData.total_images > 0);

  const one = await client.callTool({ name: 'dataset_list', arguments: { character: 'shadowheart', include_samples: 2 } });
  const oneData = jsonOf(one);
  check(
    'matches one character across differently-named source folders',
    oneData && new Set(oneData.datasets.map((entry) => entry.source)).size >= 2,
    oneData && oneData.datasets.map((entry) => `${entry.source}:${entry.name}`).join(', ')
  );
  check(
    'sample paths exist on disk',
    oneData && oneData.datasets.every((entry) => (entry.samples || []).every((file) => fs.existsSync(file)))
  );

  // ---- a tool that actually runs a script --------------------------------
  console.log('\nresize_img end to end (staged from a temp folder)');
  const sharp = require('sharp');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-mcp-'));
  const srcDir = path.join(workDir, 'src');
  const outDir = path.join(workDir, 'out');
  fs.mkdirSync(srcDir);
  for (const name of ['one', 'two']) {
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#336699' } })
      .png()
      .toFile(path.join(srcDir, `${name}.png`));
  }

  const stagedInputsBefore = fs.readdirSync(path.join(__dirname, '..', 'resize-img', 'in'));
  const resized = await client.callTool({
    name: 'resize_img',
    arguments: { input: [srcDir], output_dir: outDir, width: 400, wait_seconds: 120 },
  });
  const resizedData = jsonOf(resized);

  check('the run succeeded', !resized.isError && resizedData && resizedData.state === 'succeeded', textOf(resized).slice(0, 200));
  check('both files came back', resizedData && resizedData.output_count === 2);
  check('they are where it said they are', fs.existsSync(path.join(outDir, 'one.png')));
  const meta = fs.existsSync(path.join(outDir, 'one.png')) ? await sharp(path.join(outDir, 'one.png')).metadata() : {};
  check('and were actually resized', meta.width === 400, `width ${meta.width}`);
  check(
    "the tool's own in/ folder was left as it was",
    JSON.stringify(fs.readdirSync(path.join(__dirname, '..', 'resize-img', 'in'))) === JSON.stringify(stagedInputsBefore)
  );

  // ---- jobs --------------------------------------------------------------
  console.log('\njobs');
  const jobId = resizedData && resizedData.job;
  const status = await client.callTool({ name: 'job_status', arguments: { job: jobId } });
  const statusData = jsonOf(status);
  check('job_status finds the job just run', statusData && statusData.job === jobId);
  check('and reports it finished', statusData && statusData.state === 'succeeded');

  const logs = await client.callTool({ name: 'job_logs', arguments: { job: jobId, tail: 50 } });
  check('job_logs returns the script output', /Resizing/.test(textOf(logs)), textOf(logs).slice(0, 120));

  // A third client, to prove jobs are not held in one connection's memory.
  const third = await connect();
  const fromElsewhere = await third.callTool({ name: 'job_status', arguments: { job: jobId } });
  check('a different client can read the same job', jsonOf(fromElsewhere).job === jobId);

  const list = await client.callTool({ name: 'job_list', arguments: { limit: 5 } });
  check('job_list includes it', jsonOf(list).jobs.some((entry) => entry.job === jobId));

  const missingJob = await client.callTool({ name: 'job_status', arguments: { job: 'nope' } });
  check('job_status handles an unknown id', missingJob.isError === true);

  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nsmoke test crashed: ${err.stack || err.message}`);
  process.exit(1);
});
