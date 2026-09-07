/**
 * Running the repo's scripts as child processes.
 *
 * Every tool in this repo is a CLI that prints a human-readable summary and
 * exits nonzero if any item failed. That contract is worth keeping: the MCP
 * layer shells out rather than requiring the scripts as modules, so a tool
 * behaves identically whether a person or an agent ran it, and nothing here
 * has to be kept in sync with a script's internals.
 *
 * The wrinkle is time. A wiki scrape paces itself at one request a second, so
 * forty images is a minute or two — well past what an MCP client will sit and
 * wait for. So every long tool starts a job, waits a short while for it, and
 * hands back a job id if it is still going. Short tools finish inside the wait
 * and the caller never sees a job at all.
 */

const path = require('path');
const { spawn } = require('child_process');
const jobs = require('./jobs');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Past this the client is usually the thing that gives up, not the script.
const MAX_WAIT_SECONDS = 300;

/** Turn a command spec from the registry into [command, argv]. */
function resolveCommand(spec, args) {
  if (spec.node) {
    return [process.execPath, [path.join(REPO_ROOT, spec.node), ...args]];
  }
  if (spec.npm) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return [npm, ['run', spec.npm, '--silent', '--', ...args]];
  }
  if (spec.bash) {
    return ['bash', [path.join(REPO_ROOT, spec.bash), ...args]];
  }
  if (spec.powershell) {
    return [
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO_ROOT, spec.powershell), ...args],
    ];
  }
  if (spec.binary) {
    return [spec.binary, args];
  }
  throw new Error(`Tool has no runnable command: ${JSON.stringify(spec)}`);
}

/**
 * npm and bash arrive as .cmd/.sh shims on Windows, which spawn refuses to
 * execute directly. Everything else is a real executable and is better off
 * without a shell between it and its arguments.
 */
function needsShell(spec) {
  return process.platform === 'win32' && Boolean(spec.npm || spec.bash);
}

/**
 * Run one child process, streaming its output into an existing job's log.
 * Resolves with the exit code rather than rejecting, because a nonzero exit is
 * a result the caller reports, not an exception.
 */
function spawnInto(jobId, spec, argv, options = {}) {
  const [command, args] = resolveCommand(spec, argv);
  const cwd = options.cwd ? path.resolve(REPO_ROOT, options.cwd) : REPO_ROOT;

  if (options.label) jobs.appendLog(jobId, `\n=== ${options.label} ===\n`);
  jobs.appendLog(jobId, `$ ${command} ${args.join(' ')}\n  (in ${cwd})\n\n`);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(options.env || {}) },
        windowsHide: true,
        shell: needsShell(spec),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      jobs.appendLog(jobId, `\n[could not start] ${err.message}\n`);
      resolve({ code: null, signal: null, error: `Could not start ${command}: ${err.message}` });
      return;
    }

    jobs.update(jobId, { pid: child.pid });
    child.stdout.on('data', (chunk) => jobs.appendLog(jobId, chunk.toString()));
    child.stderr.on('data', (chunk) => jobs.appendLog(jobId, chunk.toString()));

    child.on('error', (err) => {
      jobs.appendLog(jobId, `\n[process error] ${err.message}\n`);
      resolve({ code: null, signal: null, error: err.message });
    });

    child.on('close', (code, signal) => {
      resolve({ code, signal: signal || null, error: null });
    });
  });
}

/** Close a job record out, running the tool's summariser first. */
async function finish(jobId, outcome, summarise) {
  const { code, signal, error } = outcome;
  let result = null;
  let summaryError = null;

  // The per-tool summariser reads whatever the script wrote — a manifest, an
  // output folder listing — so the caller gets data, not console text.
  if (typeof summarise === 'function') {
    try {
      result = await summarise({ code, log: jobs.readLog(jobId) });
    } catch (err) {
      summaryError = `The script finished but its results could not be read: ${err.message}`;
    }
  }

  const failed = Boolean(error) || code !== 0;
  const record = jobs.update(jobId, {
    state: failed ? 'failed' : 'succeeded',
    finished: new Date().toISOString(),
    exitCode: code,
    signal,
    result,
    error: error || summaryError || (failed ? `Exited with code ${code}${signal ? ` (${signal})` : ''}` : null),
  });

  try {
    jobs.prune();
  } catch (err) {
    /* pruning is best effort */
  }
  return record;
}

/**
 * Start a single-script tool. Returns as soon as the child is spawned; the
 * `done` promise carries the finished record.
 */
function start(toolName, spec, argv, options = {}) {
  // The tool's own arguments read better in job_list than the command line
  // they were turned into, so record those when the caller has them.
  const record = jobs.create(toolName, options.recordArgs || { argv, cwd: options.cwd || null });
  const done = spawnInto(record.id, spec, argv, options).then((outcome) =>
    finish(record.id, outcome, options.summarise)
  );
  return { record, done };
}

/**
 * Start a tool made of several scripts in sequence, all under one job record so
 * the caller polls one id and reads one log. `steps` is a list of
 * { label, spec, argv, cwd, optional, summarise } run in order; a failing step
 * stops the rest unless it is marked optional.
 */
function startComposite(toolName, args, steps, options = {}) {
  const record = jobs.create(toolName, args);

  const done = (async () => {
    const stepResults = [];
    let worst = { code: 0, signal: null, error: null };

    for (const step of steps) {
      const outcome = await spawnInto(record.id, step.spec, step.argv, {
        cwd: step.cwd,
        env: step.env,
        label: step.label,
      });

      let data = null;
      if (typeof step.summarise === 'function') {
        try {
          data = await step.summarise({ code: outcome.code, log: jobs.readLog(record.id) });
        } catch (err) {
          data = { error: err.message };
        }
      }

      const ok = !outcome.error && outcome.code === 0;
      stepResults.push({
        step: step.label,
        ok,
        exitCode: outcome.code,
        error: outcome.error,
        result: data,
      });
      jobs.update(record.id, { result: { steps: stepResults } });

      if (!ok) {
        if (step.optional) {
          jobs.appendLog(record.id, `\n[${step.label} failed; carrying on — this step is optional]\n`);
          continue;
        }
        worst = outcome;
        jobs.appendLog(record.id, `\n[${step.label} failed; stopping here]\n`);
        break;
      }
    }

    return finish(record.id, worst, async () => {
      const extra = typeof options.summarise === 'function' ? await options.summarise(stepResults) : {};
      return { steps: stepResults, ...extra };
    });
  })();

  return { record, done };
}

/** Resolve to the finished record, or to null if the wait ran out first. */
function waitFor(done, seconds) {
  const ms = Math.min(Math.max(0, seconds), MAX_WAIT_SECONDS) * 1000;
  if (ms === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    done.then((record) => {
      clearTimeout(timer);
      resolve(record);
    });
  });
}

/** Start a tool and wait up to `waitSeconds`; hand back whatever state it is in. */
async function run(toolName, spec, argv, options = {}) {
  const { record, done } = start(toolName, spec, argv, options);
  const finished = await waitFor(done, options.waitSeconds ?? 25);
  return finished || jobs.read(record.id);
}

module.exports = {
  run,
  start,
  startComposite,
  spawnInto,
  finish,
  waitFor,
  resolveCommand,
  REPO_ROOT,
  MAX_WAIT_SECONDS,
};
