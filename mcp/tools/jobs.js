/**
 * Tools for the jobs the other tools start.
 *
 * A scrape takes minutes, so the tool that started it hands back a job id and
 * these three are how the caller follows it: what state is it in, what has it
 * printed, and what else has run recently.
 */

const jobs = require('../lib/jobs');
const { toolResult, formatBytes } = require('./common');

/** Trim a record down to what is worth sending back. */
function present(record, { includeResult = true } = {}) {
  const view = {
    job: record.id,
    tool: record.tool,
    state: record.state,
    started: record.started,
    finished: record.finished,
    exit_code: record.exitCode,
  };
  if (record.error) view.error = record.error;
  if (includeResult && record.result) view.result = record.result;
  if (record.args) view.args = record.args;
  return view;
}

/** How long a job ran, or has been running. */
function elapsed(record) {
  const end = record.finished ? Date.parse(record.finished) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(record.started)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const jobStatus = {
  name: 'job_status',
  title: 'Check a running or finished job',
  description:
    'Look up a job by id: whether it is still running, what it produced, and the tail of its output. ' +
    'Tools that take minutes — the scrapers, character_pack, downloads, background removal — hand back ' +
    'a job id once their wait runs out, and this is how to follow one to the end.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['job'],
    properties: {
      job: { type: 'string', minLength: 1, description: 'The job id, as returned by the tool that started it.' },
      tail: {
        type: 'integer',
        minimum: 0,
        maximum: 500,
        default: 30,
        description: 'How many trailing log lines to include. 0 for none.',
      },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  async run(args) {
    const record = jobs.read(args.job);
    if (!record) {
      return toolResult(
        `No job "${args.job}". Job ids look like 20260823T143012-scrape_wiki-a1b2c3; job_list shows recent ones.`,
        null,
        { isError: true }
      );
    }

    // A running record whose process is gone gets corrected here rather than
    // reported as still running forever.
    const current = jobs.reconcile(record);
    const view = { ...present(current), elapsed: elapsed(current) };
    if (args.tail) view.log_tail = jobs.readLog(current.id, args.tail);

    const headline =
      current.state === 'running'
        ? `${current.tool} is still running (${elapsed(current)} so far).`
        : current.state === 'succeeded'
          ? `${current.tool} finished in ${elapsed(current)}.`
          : `${current.tool} ${current.state}: ${current.error || 'no detail recorded'}`;

    return toolResult(headline, view, { isError: current.state === 'failed' });
  },
};

const jobLogs = {
  name: 'job_logs',
  title: 'Read a job log',
  description:
    'Read the full console output of a job — everything the underlying script printed, as it printed ' +
    'it. Works on a job that is still running, so this is how to watch a long scrape make progress.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['job'],
    properties: {
      job: { type: 'string', minLength: 1, description: 'The job id.' },
      tail: {
        type: 'integer',
        minimum: 0,
        maximum: 5000,
        default: 200,
        description: 'How many trailing lines to return. 0 returns the whole log, which can be long.',
      },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },

  async run(args) {
    const record = jobs.read(args.job);
    if (!record) {
      return toolResult(`No job "${args.job}". job_list shows recent ones.`, null, { isError: true });
    }

    const log = jobs.readLog(args.job, args.tail);
    if (!log.trim()) {
      return toolResult(`Job ${args.job} (${record.state}) has not printed anything yet.`, present(record));
    }

    return {
      content: [
        {
          type: 'text',
          text: `${record.tool} — ${record.state}, ${elapsed(record)}\n\n${log}`,
        },
      ],
    };
  },
};

const jobList = {
  name: 'job_list',
  title: 'List recent jobs',
  description:
    'List recent tool runs, newest first, with what they were and how they ended. Useful for picking ' +
    'up a job id after losing it, and for seeing whether something is still running before starting ' +
    'another one that would queue behind it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'How many to return.' },
      state: {
        type: 'string',
        enum: ['running', 'succeeded', 'failed', 'orphaned'],
        description: 'Only jobs in this state.',
      },
      tool: { type: 'string', description: 'Only jobs from this tool, e.g. "scrape_wiki".' },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  async run(args) {
    const records = jobs
      .list({ limit: args.limit, state: args.state || null, tool: args.tool || null })
      .map((record) => jobs.reconcile(record));

    if (records.length === 0) {
      return toolResult('No jobs recorded yet.', { jobs: [] });
    }

    const running = records.filter((record) => record.state === 'running').length;
    const listed = records.map((record) => ({
      ...present(record, { includeResult: false }),
      elapsed: elapsed(record),
    }));

    return toolResult(
      `${records.length} job(s)${running ? `, ${running} still running` : ''}.`,
      { jobs: listed }
    );
  },
};

module.exports = [jobStatus, jobLogs, jobList];
