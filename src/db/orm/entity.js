import { typeFor } from './types.js';

/**
 * Converts a camelCase field name to snake_case column name.
 * @param {string} field
 * @returns {string}
 */
export function toSnake(field) {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Normalizes a single column entry of the entity definition.
 *
 * A column may be declared as a shorthand string (`'title'`), meaning a
 * nullable TEXT column, or as an object:
 *   { type, primaryKey, autoIncrement, nullable, unique, index, default,
 *     check, validate, references }
 *
 * `validate` is a function `(value) => true | string | undefined` or an array
 * of such functions. Each receives the field value; returning `true` or
 * `undefined` signals validity, any other string becomes the error message.
 * Users compose helpers from the `validator` library:
 *
 *   validate: (v) => isEmail(v) || 'must be a valid email'
 * @param {string} field
 * @param {string | object} raw
 * @returns {object}
 */
function normalizeColumn(field, raw) {
  const cfg = typeof raw === 'string' ? { type: raw } : { type: 'text', ...raw };
  const column = cfg.column ?? toSnake(field);
  const type = cfg.type ?? 'text';
  if (!typeFor(type)) throw new Error(`Unknown column type "${type}" on field "${field}"`);

  const primaryKey = Boolean(cfg.primaryKey);
  const nullable = primaryKey ? false : cfg.nullable !== undefined ? Boolean(cfg.nullable) : true;

  return {
    field,
    column,
    type,
    primaryKey,
    autoIncrement: Boolean(cfg.autoIncrement),
    nullable,
    unique: Boolean(cfg.unique),
    index: Boolean(cfg.index),
    default: cfg.default,
    check: cfg.check ?? null,
    validate: cfg.validate ?? null,
    references: cfg.references ?? null,
  };
}

/**
 * Builds a single SQL `CREATE`-style column clause, e.g.
 *   `"title" TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
 *
 * When `{ add: true }` the clause is suitable for `ALTER TABLE ADD COLUMN`:
 * PRIMARY KEY, AUTOINCREMENT and UNIQUE constraints are omitted (SQLite does
 * not allow them on added columns).
 * @param {object} column
 * @param {{ add?: boolean }} [opts]
 * @returns {string}
 */
export function buildColumnSql(column, opts = {}) {
  const add = opts.add ?? false;
  let sql = `"${column.column}" ${typeFor(column.type).sql}`;

  if (!add) {
    if (column.primaryKey) {
      sql += ' PRIMARY KEY';
      if (column.autoIncrement) sql += ' AUTOINCREMENT';
    }
  }
  if (!column.nullable) sql += ' NOT NULL';
  if (!add && column.unique) sql += ' UNIQUE';
  if (column.references) {
    const ref = column.references;
    sql += ` REFERENCES "${ref.table}" ("${ref.column ?? 'id'}")`;
    if (ref.onDelete) sql += ` ON DELETE ${ref.onDelete}`;
  }
  if (column.check) sql += ` CHECK (${column.check})`;
  return sql;
}

/**
 * Declares an entity schema. Returns a plain descriptor object (also usable as
 * your JSDoc model) with the metadata needed to create the table, validate and
 * map rows, and run a {@link Repository}.
 *
 * Column `validate` values are functions (or arrays of functions) that receive
 * the field value and return `true` / `undefined` for valid or an error string
 * for invalid. Helpers from the `validator` library compose naturally:
 * @example
 * import { isEmail, isLength } from 'validator';
 *
 * defineEntity({
 *   name: 'User',
 *   table: 'users',
 *   columns: {
 *     id:    { type: 'text', primaryKey: true },
 *     email: { type: 'text', unique: true,
 *              validate: (v) => isEmail(v) || 'must be a valid email' },
 *     name:  { type: 'text',
 *              validate: (v) => isLength(v, { min: 1, max: 100 }) || 'must be 1-100 chars' },
 *   },
 *   indexes: [{ columns: ['email'] }],
 *   relations: {
 *     posts: { type: 'hasMany', target: Post, foreignKey: 'userId' },
 *   },
 * })
 * @param {object} config
 * @returns {import('./entity.js').EntityDescriptor}
 */
export function defineEntity(config) {
  const columnsByField = new Map();
  for (const [field, raw] of Object.entries(config.columns ?? {})) {
    const column = normalizeColumn(field, raw);
    if (column.primaryKey && config.autoGenerateId !== false && column.type === 'text') {
      column.autoGenerateId = true;
    }
    columnsByField.set(field, column);
  }

  // implicit timestamps / soft-delete columns
  const timestamps = config.timestamps !== false;
  const softDelete = Boolean(config.softDelete);
  if (timestamps && !columnsByField.has('createdAt')) {
    columnsByField.set(
      'createdAt',
      normalizeColumn('createdAt', { type: 'text', nullable: false })
    );
  }
  if (timestamps && !columnsByField.has('updatedAt')) {
    columnsByField.set(
      'updatedAt',
      normalizeColumn('updatedAt', { type: 'text', nullable: false })
    );
  }
  if (softDelete && !columnsByField.has('deletedAt')) {
    columnsByField.set('deletedAt', normalizeColumn('deletedAt', { type: 'text', nullable: true }));
  }

  const columnsByColumn = new Map([...columnsByField.values()].map((c) => [c.column, c]));
  const primary = [...columnsByField.values()].find((c) => c.primaryKey) ?? null;
  if (!primary) throw new Error(`Entity "${config.name}" needs a primary key column`);

  const relations = new Map();
  for (const [name, rel] of Object.entries(config.relations ?? {})) {
    relations.set(name, {
      name,
      type: rel.type,
      target: rel.target,
      foreignKey: rel.foreignKey,
      localKey: rel.localKey ?? 'id',
      aliases: rel.aliases ?? null,
    });
  }

  // resolve composite index columns to their database column names
  const indexes = (config.indexes ?? []).map((idx) => {
    const columns = idx.columns.map((c) => {
      const meta = columnsByField.get(c);
      return meta ? meta.column : c;
    });
    return {
      name: idx.name ?? `idx_${config.table}_${columns.join('_')}`,
      columns,
      unique: Boolean(idx.unique),
      where: idx.where ?? null,
    };
  });

  return {
    name: config.name,
    table: config.table,
    timestamps,
    softDelete,
    autoGenerateId: config.autoGenerateId !== false,
    columnsByField,
    columnsByColumn,
    primary,
    indexes,
    relations,

    /**
     * Validates every column for which the input provides a value, returning a
     * map of field -> error message (empty when valid). Each column's validate
     * function(s) are called; returning `true` or `undefined` signals valid.
     * @param {Record<string, *>} input
     * @returns {Record<string, string>}
     */
    validate(input) {
      const errors = {};
      for (const column of columnsByField.values()) {
        if (!column.validate || input[column.field] === undefined) continue;
        const fns = Array.isArray(column.validate) ? column.validate : [column.validate];
        for (const fn of fns) {
          const result = fn(input[column.field], input);
          if (result === true || result === undefined || result === null) continue;
          errors[column.field] = String(result);
          break;
        }
      }
      return errors;
    },

    /**
     * Serializes an entity field object into a column-keyed object of SQL-safe
     * values. Undefined fields are omitted (the repository applies defaults).
     * @param {Record<string, *>} input
     * @returns {Record<string, *>}
     */
    serialize(input) {
      const out = {};
      for (const column of columnsByField.values()) {
        if (input[column.field] === undefined) continue;
        out[column.column] = typeFor(column.type).serialize(input[column.field], column.field);
      }
      return out;
    },

    /**
     * Maps a raw database row (column-keyed) back to a field-keyed entity.
     * @param {Record<string, *>} row
     * @returns {Record<string, *>}
     */
    deserialize(row) {
      const out = {};
      for (const column of columnsByField.values()) {
        if (!(column.column in row)) continue;
        out[column.field] = typeFor(column.type).deserialize(row[column.column], column.field);
      }
      return out;
    },

    /**
     * Builds the `CREATE TABLE ...` statement for this entity.
     * @returns {string}
     */
    toCreateTableSql() {
      const clauses = [...columnsByField.values()].map(buildColumnSql);
      return `CREATE TABLE IF NOT EXISTS "${this.table}" (${clauses.join(', ')})`;
    },

    /**
     * Builds the `CREATE INDEX ...` statements for single-column and composite
     * indexes declared on the entity.
     * @returns {Array<string>}
     */
    toIndexSql() {
      const sql = [];
      for (const column of columnsByField.values()) {
        if (!column.index && !(column.unique && !column.primaryKey)) continue;
        sql.push(
          `CREATE ${column.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS idx_${this.table}_${column.column} ON "${this.table}" ("${column.column}")`
        );
      }
      for (const idx of this.indexes) {
        const cols = idx.columns.map((c) => `"${c}"`).join(', ');
        const where = idx.where ? ` WHERE ${idx.where}` : '';
        sql.push(
          `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${idx.name}" ON "${this.table}" (${cols})${where}`
        );
      }
      return sql;
    },
  };
}
