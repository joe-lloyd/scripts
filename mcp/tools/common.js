/**
 * Shared plumbing for the tool registry.
 *
 * Nearly every tool here is the same three moves — turn arguments into a
 * command line, run it, describe what came out — so they are declared as data
 * and built by one factory. What differs between tools is only the flags they
 * accept and how their output is summarised.
 */

const path = require('path');
const exec = require('../lib/exec');
const jobs = require('../lib/jobs');
const { withStagedIO } = require('../lib/staging');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Long enough for the fast tools to finish inside the call, short enough that a
// client waiting on a slow one gets a job id back rather than a timeout.
const DEFAULT_WAIT_SECONDS = 25;

/** The input/output pair shared by every in/ -> out/ tool. */
function stagedSchemaProps(what = 'files') {
  return {
    input: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description:
        `Absolute paths to the ${what} to process, or to folders holding them (one level, not recursive). ` +
        'Omit to process whatever is already sitting in the tool\'s own in/ folder.',
    },
    output_dir: {
      type: 'string',
      description:
        'Absolute path for the results. Defaults to a timestamped folder under mcp/out/. ' +
        'Ignored when "input" is omitted, since results then stay in the tool\'s own out/ folder.',
    },
  };
}

const waitSchemaProp = {
  wait_seconds: {
    type: 'integer',
    minimum: 0,
    maximum: exec.MAX_WAIT_SECONDS,
    default: DEFAULT_WAIT_SECONDS,
    description:
      'How long to wait for the run before handing back a job id instead. 0 returns a job id immediately.',
  },
};

/** Build a flag list, skipping anything the caller left out. */
function flags(pairs) {
  const argv = [];
  for (const [flag, value] of pairs) {
    if (value === undefined || value === null) continue;
    if (value === false) continue;
    if (value === true) {
      argv.push(flag);
      continue;
    }
    argv.push(flag, String(value));
  }
  return argv;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * The text an MCP client sees. A short human sentence first, because that is
 * what gets read, then the machine-readable body for anything that wants to
 * chain off it.
 */
function toolResult(summary, data, { isError = false } = {}) {
  const parts = [summary];
  if (data !== undefined && data !== null) {
    parts.push('```json\n' + JSON.stringify(data, null, 2) + '\n```');
  }
  return {
    content: [{ type: 'text', text: parts.join('\n\n') }],
    isError,
  };
}

/** How much of the log to quote back — more when something went wrong. */
function logTail(record, lines) {
  const text = jobs.readLog(record.id, lines);
  return text.trim() ? text : null;
}

/**
 * Describe a finished, failed or still-running job in one place, so every tool
 * reports the same way.
 */
function describeRecord(record, { staging = null, extra = null, what = 'The tool' } = {}) {
  const base = {
    job: record.id,
    state: record.state,
    tool: record.tool,
  };

  if (staging) {
    base.output_dir = staging.outputDir;
    base.outputs = staging.outputs;
    base.output_count = staging.outputs.length;
    if (staging.staged) base.inputs_staged = staging.inputCount;
  }
  if (record.result) base.result = record.result;
  if (extra) Object.assign(base, extra);

  if (record.state === 'running') {
    return toolResult(
      `${what} is still running after the wait — job ${record.id}. ` +
        'Poll it with job_status, or read its output so far with job_logs.',
      { ...base, log_tail: logTail(record, 12) }
    );
  }

  if (record.state === 'failed' || record.state === 'orphaned') {
    return toolResult(
      `${what} failed: ${record.error || 'unknown error'} (job ${record.id})`,
      { ...base, error: record.error, log_tail: logTail(record, 40) },
      { isError: true }
    );
  }

  const count = staging ? ` ${staging.outputs.length} file(s) in ${staging.outputDir}` : '';
  return toolResult(`Done${count ? ` —${count}` : ''}. (job ${record.id})`, {
    ...base,
    log_tail: logTail(record, 20),
  });
}

/**
 * Run a tool whose script reads its own in/ folder, with the caller's files
 * staged into it.
 *
 * The staging has to be unwound only once the child has actually exited, which
 * is not the same moment the caller stops waiting. So the wait races a promise
 * that covers the whole run *and* the unstaging, and if it runs out the job
 * carries on and tidies up after itself in the background.
 */
async function runStaged(name, spec, argv, options) {
  const { stageDir, input, outputDir, cwd, summarise, waitSeconds, args } = options;
  const record = jobs.create(name, args);

  const settled = withStagedIO(name, path.join(REPO_ROOT, stageDir), { input, outputDir }, async () => {
    const outcome = await exec.spawnInto(record.id, spec, argv, { cwd });
    return exec.finish(record.id, outcome, null);
  })
    .then(async (staging) => {
      const current = jobs.read(record.id);
      const extra = await applySummary(summarise, { args, record: current, staging });
      const updated = jobs.update(record.id, {
        result: {
          ...(current.result || {}),
          output_dir: staging.outputDir,
          outputs: staging.outputs,
          ...(extra || {}),
        },
      });
      return { record: updated, staging };
    })
    .catch((err) => {
      // Staging itself failed — a missing input, or a tool busy with another
      // run. The job record is the honest place to say so.
      const updated = jobs.update(record.id, {
        state: 'failed',
        finished: new Date().toISOString(),
        error: err.message,
      });
      return { record: updated || jobs.read(record.id), staging: null };
    });

  const finished = await exec.waitFor(settled, waitSeconds ?? DEFAULT_WAIT_SECONDS);
  return finished || { record: jobs.read(record.id), staging: null };
}

/**
 * A summariser reads whatever the script left on disk. It runs after the child
 * exits, and a failure to read results is worth reporting but never worth
 * turning a successful run into a failed one.
 */
async function applySummary(summarise, context) {
  if (typeof summarise !== 'function') return null;
  try {
    return await summarise(context);
  } catch (err) {
    return { summary_error: `The run finished but its results could not be read: ${err.message}` };
  }
}

/** Run a tool that needs no staging, because it takes paths on its command line. */
async function runDirect(name, spec, argv, options = {}) {
  const { record, done } = exec.start(name, spec, argv, {
    cwd: options.cwd,
    env: options.env,
    recordArgs: options.args,
  });

  const settled = done.then(async (finishedRecord) => {
    const extra = await applySummary(options.summarise, {
      args: options.args,
      record: finishedRecord,
      staging: null,
    });
    if (!extra) return { record: finishedRecord, staging: null };
    return {
      record: jobs.update(finishedRecord.id, { result: { ...(finishedRecord.result || {}), ...extra } }),
      staging: null,
    };
  });

  const finished = await exec.waitFor(settled, options.waitSeconds ?? DEFAULT_WAIT_SECONDS);
  return finished || { record: jobs.read(record.id), staging: null };
}

/**
 * Declare a tool backed by one script.
 *
 * `stageDir` marks the tools whose folders are hardcoded; everything else takes
 * its paths as arguments and runs directly.
 */
function scriptTool(definition) {
  const {
    name,
    title,
    description,
    command,
    schema,
    annotations = {},
    buildArgv = () => [],
    stageDir = null,
    cwd = null,
    summarise = null,
    what = 'The tool',
  } = definition;

  return {
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      ...schema,
      properties: {
        ...(schema.properties || {}),
        ...(stageDir ? stagedSchemaProps(definition.inputWhat || 'files') : {}),
        ...waitSchemaProp,
      },
    },
    annotations: { openWorldHint: false, ...annotations },
    async run(args) {
      // A tool whose mode maps to a different script resolves its command per
      // call. Storing it on the definition instead would let two concurrent
      // calls with different modes overwrite each other.
      const spec = typeof command === 'function' ? command(args) : command;
      const argv = buildArgv(args);
      const options = {
        args,
        stageDir,
        input: args.input || null,
        outputDir: args.output_dir || null,
        cwd: typeof cwd === 'function' ? cwd(args) : cwd,
        summarise,
        waitSeconds: args.wait_seconds,
      };

      const { record, staging } = stageDir
        ? await runStaged(name, spec, argv, options)
        : await runDirect(name, spec, argv, options);

      return describeRecord(record, { staging, what });
    },
  };
}

module.exports = {
  scriptTool,
  runStaged,
  runDirect,
  applySummary,
  describeRecord,
  toolResult,
  logTail,
  flags,
  formatBytes,
  stagedSchemaProps,
  waitSchemaProp,
  DEFAULT_WAIT_SECONDS,
  REPO_ROOT,
};
