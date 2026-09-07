/**
 * Calling a PowerShell script with arguments that survive the trip.
 *
 * get-audio is the one tool here that is PowerShell rather than Node, and its
 * -Url parameter takes a string array. Passing several values through
 * `powershell -File script.ps1 -Url a b c` binds only the first and then errors
 * on the rest, so the call is built as a single -Command string instead, with
 * PowerShell's own escaping: single quotes throughout, doubled to escape.
 *
 * Everything stays inside one argument, so Node's own Windows quoting has
 * nothing to mangle on the way out.
 */

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Build the argv for powershell.exe.
 * `params` is [name, value] pairs; false/null/undefined values are dropped and
 * `true` becomes a bare switch.
 */
function callScript(scriptPath, params = []) {
  const parts = [`& ${quote(scriptPath)}`];

  for (const [name, value] of params) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(name, Array.isArray(value) ? value.map(quote).join(',') : quote(value));
  }

  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', parts.join(' ')];
}

module.exports = { callScript, quote };
