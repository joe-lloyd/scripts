/**
 * Disk-backed job records.
 *
 * "Stateless" here means the HTTP layer: every POST /mcp is self-contained, no
 * session id, no server-side conversation state. Long-running work still needs
 * somewhere to live, and putting it on disk rather than in a module-level Map
 * buys two things — a job survives a server restart well enough to report what
 * happened, and a stdio server started by one project can read a job started by
 * another. The filesystem is the shared state; the protocol layer has none.
 *
 * One JSON file per job for the record, one .log file beside it for the child
 * process output, appended as it arrives so job_logs can tail a running job.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOBS_DIR = path.join(__dirname, '..', '.jobs');

// Enough history to answer "what did I run yesterday" without unbounded growth.
const MAX_JOBS_KEPT = 200;

function ensureDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function recordPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

function logPath(id) {
  return path.join(JOBS_DIR, `${id}.log`);
}

/** Sortable id: the timestamp prefix makes a plain readdir chronological. */
function newId(tool) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${stamp}-${tool}-${crypto.randomBytes(3).toString('hex')}`;
}

function create(tool, args) {
  ensureDir();
  const id = newId(tool);
  const record = {
    id,
    tool,
    args,
    state: 'running',
    started: new Date().toISOString(),
    finished: null,
    exitCode: null,
    error: null,
    result: null,
    pid: null,
  };
  write(record);
  fs.writeFileSync(logPath(id), '', 'utf8');
  return record;
}

function write(record) {
  ensureDir();
  // Write-then-rename so a reader never catches a half-written file.
  const tmp = `${recordPath(record.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, recordPath(record.id));
  return record;
}

function read(id) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
  } catch (err) {
    return null;
  }
}

function update(id, patch) {
  const record = read(id);
  if (!record) return null;
  return write({ ...record, ...patch });
}

function appendLog(id, chunk) {
  try {
    fs.appendFileSync(logPath(id), chunk, 'utf8');
  } catch (err) {
    // A job whose log cannot be written is still a job worth finishing.
  }
}

/** Read the log, optionally only the last N lines. */
function readLog(id, tailLines = 0) {
  let text;
  try {
    text = fs.readFileSync(logPath(id), 'utf8');
  } catch (err) {
    return '';
  }
  if (!tailLines || tailLines <= 0) return text;
  // Logs end with a newline, which would otherwise spend a tail slot on ''.
  const lines = text.replace(/\n$/, '').split('\n');
  return lines.slice(Math.max(0, lines.length - tailLines)).join('\n');
}

function list({ limit = 20, state = null, tool = null } = {}) {
  ensureDir();
  const ids = fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
    .reverse();

  const records = [];
  for (const id of ids) {
    const record = read(id);
    if (!record) continue;
    if (state && record.state !== state) continue;
    if (tool && record.tool !== tool) continue;
    records.push(record);
    if (records.length >= limit) break;
  }
  return records;
}

/** Drop the oldest records once the directory grows past MAX_JOBS_KEPT. */
function prune() {
  ensureDir();
  const ids = fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();

  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_JOBS_KEPT))) {
    const record = read(id);
    if (record && record.state === 'running') continue;
    fs.rmSync(recordPath(id), { force: true });
    fs.rmSync(logPath(id), { force: true });
  }
}

/**
 * A running record whose process is gone — the server was restarted or killed
 * mid-job. Reported honestly rather than left claiming to still be running.
 */
function reconcile(record) {
  if (record.state !== 'running' || !record.pid) return record;
  try {
    process.kill(record.pid, 0);
    return record;
  } catch (err) {
    if (err.code === 'EPERM') return record; // alive, just not ours to signal
    return update(record.id, {
      state: 'orphaned',
      finished: new Date().toISOString(),
      error: 'The server stopped while this job was running; its output up to that point is in the log.',
    });
  }
}

module.exports = { create, read, update, appendLog, readLog, list, prune, reconcile, JOBS_DIR };
