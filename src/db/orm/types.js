/**
 * Column value codecs: how a JS value is validated, serialized into a SQL
 * literal and deserialized back from a database row.
 *
 * Each codec is a plain object with:
 *   - `sql`: SQLite column type string used in DDL
 *   - `serialize(value, key)`: JS value -> SQL value (or throws a TypeError/range
 *     error on obviously invalid input)
 *   - `deserialize(raw, key)`: raw DB value -> JS value
 *   - `validate(value, key)` (optional): returns an error string or `null` when
 *     the value is acceptable at the entity level (beyond type coercion)
 */

/** @type {Object<string, object>} */
export const types = {
  text: {
    sql: 'TEXT',
    serialize(value) {
      if (value === null || value === undefined) return value;
      return String(value);
    },
    deserialize(raw) {
      return raw;
    },
  },

  integer: {
    sql: 'INTEGER',
    serialize(value) {
      if (value === null || value === undefined) return value;
      if (!Number.isInteger(value)) {
        throw new TypeError(`Expected an integer, got ${JSON.stringify(value)}`);
      }
      return value;
    },
    deserialize(raw) {
      return raw;
    },
  },

  real: {
    sql: 'REAL',
    serialize(value) {
      if (value === null || value === undefined) return value;
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new TypeError(`Expected a number, got ${JSON.stringify(value)}`);
      }
      return value;
    },
    deserialize(raw) {
      return raw;
    },
  },

  boolean: {
    sql: 'INTEGER',
    serialize(value) {
      if (value === null || value === undefined) return value;
      return value ? 1 : 0;
    },
    deserialize(raw) {
      return raw === null || raw === undefined ? raw : Boolean(raw);
    },
  },

  json: {
    sql: 'TEXT',
    serialize(value) {
      if (value === null || value === undefined) return value;
      return JSON.stringify(value);
    },
    deserialize(raw) {
      if (raw === null || raw === undefined) return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
  },
};

/** Human-readable alias → canonical type name. */
const aliases = {
  string: 'text',
  str: 'text',
  number: 'real',
  float: 'real',
  int: 'integer',
  bool: 'boolean',
  array: 'json',
  object: 'json',
  json: 'json',
};

/**
 * Returns the codec for a column type, throwing on an unknown type name.
 * Accepts canonical type names and common aliases (string, int, bool, etc).
 * @param {string} type
 * @returns {object}
 */
export function typeFor(type) {
  const canonical = aliases[type] ?? type;
  const codec = types[canonical];
  if (!codec) throw new Error(`Unknown column type "${type}"`);
  return codec;
}
