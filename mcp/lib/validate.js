/**
 * A small validator for the subset of JSON Schema the tool registry uses.
 *
 * The MCP SDK validates the JSON-RPC envelope but not tool arguments — that is
 * the server's job. Every tool here ends up as arguments to a child process, so
 * a wrong type is the difference between "limit must be a number" and a shell
 * argument that means something else entirely. Rather than pull in a full
 * validator for eight keywords, this covers exactly what tools.js declares:
 * type, enum, required, additionalProperties, min/max, and array items.
 */

const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
}

/** Validate one value against one property schema. Returns an array of problems. */
function checkValue(value, schema, label) {
  const problems = [];

  if (schema.type && KNOWN_TYPES.has(schema.type) && !matchesType(value, schema.type)) {
    problems.push(`${label} must be ${schema.type === 'integer' ? 'a whole number' : `a ${schema.type}`}, got ${typeOf(value)}`);
    // Every check below assumes the type held, so stop here.
    return problems;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${label} must be one of: ${schema.enum.join(', ')} (got ${JSON.stringify(value)})`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(`${label} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(`${label} must be at most ${schema.maximum}`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${label} must not be empty`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${label} does not look right (expected ${schema.pattern})`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${label} needs at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${label} takes at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        problems.push(...checkValue(item, schema.items, `${label}[${i}]`));
      });
    }
  }

  return problems;
}

/**
 * Validate tool arguments, filling in declared defaults.
 * Throws an Error listing every problem at once — one round trip per mistake
 * beats one round trip per mistake per field.
 */
function validate(schema, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  const properties = schema.properties || {};
  const required = schema.required || [];
  const problems = [];

  for (const name of required) {
    if (args[name] === undefined || args[name] === null) {
      problems.push(`${name} is required`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const name of Object.keys(args)) {
      if (!properties[name]) {
        const known = Object.keys(properties).join(', ');
        problems.push(`unknown argument "${name}" (accepted: ${known || 'none'})`);
      }
    }
  }

  const result = {};
  for (const [name, propSchema] of Object.entries(properties)) {
    const value = args[name];
    if (value === undefined || value === null) {
      if (propSchema.default !== undefined) result[name] = propSchema.default;
      continue;
    }
    problems.push(...checkValue(value, propSchema, name));
    result[name] = value;
  }

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
  return result;
}

module.exports = { validate };
