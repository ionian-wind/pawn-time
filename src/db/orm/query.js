/**
 * Wraps a column name in double quotes for safe SQL.
 * @param {string} column
 * @returns {string}
 */
function col(column) {
  return `"${column}"`;
}

/**
 * Resolves a camelCase field name to its snake_case column name using the
 * entity descriptor. Throws when the field is unknown.
 * @param {string} field
 * @param {import('./entity.js').EntityDescriptor} entity
 * @returns {string}
 */
function resolveColumn(field, entity) {
  const meta = entity.columnsByField.get(field);
  if (!meta) throw new Error(`Unknown field "${field}" on entity "${entity.name}"`);
  return meta.column;
}

/**
 * Builds a parameterized WHERE clause from a where-specification object.
 *
 * Plain equality:    `{ email: 'a@b.c' }`              → `"email" = ?`
 * Comparison ops:    `{ age: { gte: 21 } }`            → `"age" >= ?`
 * IN / NOT IN:       `{ status: { in: ['a', 'b'] } }`  → `"status" IN (?, ?)`
 * IS NULL:           `{ deletedAt: { isNull: true } }` → `"deleted_at" IS NULL`
 * LIKE:              `{ name: { like: '%foo%' } }`     → `"name" LIKE ?`
 * BETWEEN:           `{ age: { between: [18, 65] } }`  → `"age" BETWEEN ? AND ?`
 *
 * Raw escape hatch:
 *   `{ _raw: 'created_at > ?', _params: ['2024-01-01'] }`
 * @param {Record<string, *>|object} where
 * @param {import('./entity.js').EntityDescriptor} entity
 * @returns {{ sql: string, params: *[] }}
 */
export function buildWhere(where, entity) {
  if (!where) return { sql: '', params: [] };

  // raw escape hatch
  if (where._raw) return { sql: where._raw, params: where._params ?? [] };

  /** @type {string[]} */
  const clauses = [];
  /** @type {*[]} */
  const params = [];

  for (const [field, spec] of Object.entries(where)) {
    const column = col(resolveColumn(field, entity));

    if (spec === null) {
      clauses.push(`${column} IS NULL`);
      continue;
    }
    if (typeof spec === 'object' && !Array.isArray(spec)) {
      if (spec.eq !== undefined) {
        clauses.push(`${column} = ?`);
        params.push(spec.eq);
      } else if (spec.ne !== undefined) {
        clauses.push(`${column} <> ?`);
        params.push(spec.ne);
      } else if (spec.gt !== undefined) {
        clauses.push(`${column} > ?`);
        params.push(spec.gt);
      } else if (spec.gte !== undefined) {
        clauses.push(`${column} >= ?`);
        params.push(spec.gte);
      } else if (spec.lt !== undefined) {
        clauses.push(`${column} < ?`);
        params.push(spec.lt);
      } else if (spec.lte !== undefined) {
        clauses.push(`${column} <= ?`);
        params.push(spec.lte);
      } else if (spec.like !== undefined) {
        clauses.push(`${column} LIKE ?`);
        params.push(spec.like);
      } else if (spec.notLike !== undefined) {
        clauses.push(`${column} NOT LIKE ?`);
        params.push(spec.notLike);
      } else if (spec.in) {
        const vals = Array.isArray(spec.in) ? spec.in : [spec.in];
        if (vals.length === 0) {
          clauses.push('0');
        } else {
          clauses.push(`${column} IN (${vals.map(() => '?').join(', ')})`);
          params.push(...vals);
        }
      } else if (spec.notIn) {
        const vals = Array.isArray(spec.notIn) ? spec.notIn : [spec.notIn];
        if (vals.length === 0) {
          clauses.push('1');
        } else {
          clauses.push(`${column} NOT IN (${vals.map(() => '?').join(', ')})`);
          params.push(...vals);
        }
      } else if (spec.between) {
        clauses.push(`${column} BETWEEN ? AND ?`);
        params.push(spec.between[0], spec.between[1]);
      } else if (spec.isNull) {
        clauses.push(`${column} IS NULL`);
      } else if (spec.isNotNull) {
        clauses.push(`${column} IS NOT NULL`);
      } else {
        // object but no recognized operator — treat as equality on the raw value
        clauses.push(`${column} = ?`);
        params.push(spec);
      }
    } else {
      clauses.push(`${column} = ?`);
      params.push(spec);
    }
  }

  if (clauses.length === 0) return { sql: '', params: [] };
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

/**
 * Builds a WHERE ... IN (...) clause for a list of primary-key values.
 * Useful for eager-loading relations.
 * @param {string} column - database column name (already snake_case)
 * @param {Array<*>} values
 * @returns {{ sql: string, params: *[] }}
 */
export function buildWhereIn(column, values) {
  if (!values || values.length === 0) return { sql: 'WHERE 0', params: [] };
  return {
    sql: `WHERE ${col(column)} IN (${values.map(() => '?').join(', ')})`,
    params: values,
  };
}

/**
 * Builds an ORDER BY clause from a sort-specification object.
 *
 * `{ createdAt: 'desc' }`  → `ORDER BY "created_at" DESC`
 * `[{ createdAt: 'asc' }]` → `ORDER BY "created_at" ASC`
 * `'created_at DESC'`      → `ORDER BY created_at DESC` (raw)
 * @param {string|object|Array<object>} orderBy
 * @param {import('./entity.js').EntityDescriptor} entity
 * @returns {string}
 */
export function buildOrderBy(orderBy, entity) {
  if (!orderBy) return '';
  if (typeof orderBy === 'string') return `ORDER BY ${orderBy}`;

  const entries = Array.isArray(orderBy)
    ? orderBy.map((o) => Object.entries(o)[0])
    : Object.entries(orderBy);

  if (entries.length === 0) return '';

  const parts = entries.map(([field, direction]) => {
    const column = col(resolveColumn(field, entity));
    const dir = String(direction).toUpperCase();
    return `${column} ${dir === 'DESC' ? 'DESC' : 'ASC'}`;
  });

  return `ORDER BY ${parts.join(', ')}`;
}

/**
 * Builds LIMIT / OFFSET clause strings. Both are optional.
 * @param {number} [limit]
 * @param {number} [offset]
 * @returns {string}
 */
export function buildLimitOffset(limit, offset) {
  let sql = '';
  if (limit != null) sql += ` LIMIT ${Number(limit)}`;
  if (offset != null) sql += ` OFFSET ${Number(offset)}`;
  return sql;
}
