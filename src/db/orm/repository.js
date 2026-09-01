import { randomUUID } from 'node:crypto';
import { buildWhere, buildWhereIn, buildOrderBy, buildLimitOffset } from './query.js';
import { EntityValidationError } from './errors.js';
import { transactionFor } from './transaction.js';

/**
 * Generic repository for an entity descriptor. All queries are run against the
 * provided `better-sqlite3` Database instance.
 * @example
 * import Database from 'better-sqlite3';
 * import { defineEntity, Repository } from './orm/index.js';
 *
 * const User = defineEntity({ name: 'User', table: 'users', columns: { id: { type: 'text', primaryKey: true }, email: { type: 'text' } } });
 * const repo = new Repository(User, new Database(':memory:'));
 * repo.create({ email: 'a@b.c' });
 * repo.findByPk(id);
 */
export class Repository {
  /**
   * @param {import('./entity.js').EntityDescriptor} entity
   * @param {import('better-sqlite3').Database} db
   */
  constructor(entity, db) {
    /** @type {import('./entity.js').EntityDescriptor} */
    this.entity = entity;
    /** @type {import('better-sqlite3').Database} */
    this.db = db;
  }

  /**
   * Current timestamp as an ISO string.
   * @returns {string}
   */
  static now() {
    return new Date().toISOString();
  }

  /**
   * Builds the full WHERE + ORDER BY + LIMIT/OFFSET fragment for a find
   * operation, including optional soft-delete filtering.
   * @param {object} [opts]
   * @param {Record<string, *>} [opts.where]
   * @param {string|object|Array<object>} [opts.orderBy]
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   * @param {boolean} [opts.includeDeleted]
   * @returns {{ sql: string, params: *[] }}
   */
  #buildQuery(opts = {}) {
    const { where = {}, orderBy, limit, offset, includeDeleted } = opts;
    let fullWhere = { ...where };
    if (this.entity.softDelete && !includeDeleted) {
      fullWhere.deletedAt = { isNull: true };
    }
    const w = buildWhere(fullWhere, this.entity);
    const o = buildOrderBy(orderBy, this.entity);
    const l = buildLimitOffset(limit, offset);
    return { sql: `SELECT * FROM "${this.entity.table}" ${w.sql} ${o} ${l}`, params: w.params };
  }

  /**
   * Creates a new row. Validates input, applies column defaults and timestamps,
   * serializes values, and returns the created entity.
   * @param {Record<string, *>} input
   * @returns {Record<string, *>}
   */
  create(input) {
    this.#validate(input, 'create');
    const now = Repository.now();
    const data = { ...input };
    this.#applyDefaults(data);
    if (this.entity.timestamps) {
      if (data.createdAt === undefined) data.createdAt = now;
      if (data.updatedAt === undefined) data.updatedAt = now;
    }
    if (this.entity.softDelete && data.deletedAt === undefined) {
      data.deletedAt = null;
    }
    if (this.entity.autoGenerateId && data[this.entity.primary.field] === undefined) {
      data[this.entity.primary.field] = randomUUID();
    }
    const serialized = this.entity.serialize(data);
    const columns = Object.keys(serialized);
    const values = Object.values(serialized);
    const placeholders = columns.map(() => '?').join(', ');
    this.db
      .prepare(
        `INSERT INTO "${this.entity.table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
      )
      .run(...values);
    return this.findByPk(data[this.entity.primary.field]);
  }

  /**
   * Finds a row by primary key, returning `null` when missing or soft-deleted
   * (pass `includeDeleted` to include soft-deleted rows).
   * @param {*} id
   * @param {object} [opts]
   * @param {boolean} [opts.includeDeleted]
   * @returns {Record<string, *> | null}
   */
  findByPk(id, opts = {}) {
    if (id === undefined || id === null) return null;
    const pkCol = this.entity.primary.column;
    let sql = `SELECT * FROM "${this.entity.table}" WHERE "${pkCol}" = ?`;
    if (this.entity.softDelete && !opts.includeDeleted) {
      sql += ' AND "deleted_at" IS NULL';
    }
    const row = this.db.prepare(sql).get(id);
    return row ? this.entity.deserialize(row) : null;
  }

  /**
   * Returns the first row matching the where clause, or `null`.
   * @param {Record<string, *>} [where]
   * @param {object} [opts]
   * @returns {Record<string, *> | null}
   */
  findOne(where = {}, opts = {}) {
    const { sql, params } = this.#buildQuery({ where, limit: 1, ...opts });
    const row = this.db.prepare(sql).get(...params);
    return row ? this.entity.deserialize(row) : null;
  }

  /**
   * Returns all rows matching the where clause. Supports eager-loading
   * relations via `include`.
   * @param {object} opts
   * @param {Record<string, *>} [opts.where]
   * @param {string|object|Array<object>} [opts.orderBy]
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   * @param {string[]} [opts.include]
   * @param {boolean} [opts.includeDeleted]
   * @returns {Array<Record<string, *>>}
   */
  findMany(opts = {}) {
    const { include, ...queryOpts } = opts;
    const { sql, params } = this.#buildQuery(queryOpts);
    const rows = this.db.prepare(sql).all(...params);
    const entities = rows.map((row) => this.entity.deserialize(row));
    if (include && include.length > 0) {
      this.#eagerLoad(entities, include);
    }
    return entities;
  }

  /**
   * Returns the count of rows matching the where clause.
   * @param {Record<string, *>} [where]
   * @param {object} [opts]
   * @returns {number}
   */
  count(where = {}, opts = {}) {
    let fullWhere = { ...where };
    if (this.entity.softDelete && !opts.includeDeleted) {
      fullWhere.deletedAt = { isNull: true };
    }
    const w = buildWhere(fullWhere, this.entity);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM "${this.entity.table}" ${w.sql}`)
      .get(...w.params);
    return row.cnt;
  }

  /**
   * Updates the specified fields of a row identified by its primary key.
   * Returns the updated entity, or `null` if the row does not exist.
   * @param {*} id - primary key
   * @param {Record<string, *>} data - fields to update
   * @returns {Record<string, *> | null}
   */
  update(id, data) {
    const existing = this.findByPk(id);
    if (!existing) return null;
    this.#validate(data, 'update');
    const now = Repository.now();
    const input = { ...data };
    if (this.entity.timestamps && input.updatedAt === undefined) {
      input.updatedAt = now;
    }
    const serialized = this.entity.serialize(input);
    const entries = Object.entries(serialized);
    if (entries.length === 0) return existing;
    const pkCol = this.entity.primary.column;
    const setClauses = entries.map(([c]) => `"${c}" = ?`);
    const values = entries.map(([, v]) => v);
    this.db
      .prepare(`UPDATE "${this.entity.table}" SET ${setClauses.join(', ')} WHERE "${pkCol}" = ?`)
      .run(...values, id);
    return this.findByPk(id);
  }

  /**
   * Deletes a row by primary key. Performs a hard delete. When soft-delete
   * is enabled, sets `deleted_at` instead.
   * @param {*} id
   * @returns {boolean}
   */
  delete(id) {
    const pkCol = this.entity.primary.column;
    if (this.entity.softDelete) {
      const result = this.db
        .prepare(`UPDATE "${this.entity.table}" SET "deleted_at" = ? WHERE "${pkCol}" = ?`)
        .run(Repository.now(), id);
      return result.changes > 0;
    }
    const result = this.db
      .prepare(`DELETE FROM "${this.entity.table}" WHERE "${pkCol}" = ?`)
      .run(id);
    return result.changes > 0;
  }

  /**
   * Runs the given function inside a transaction, passing the database handle.
   * Nested calls are supported through savepoints.
   * @param {(db: import('better-sqlite3').Database) => T} fn
   * @returns {T}
   */
  transaction(fn) {
    return transactionFor(this.db).run(() => fn(this.db));
  }

  // ---- private helpers ----

  /**
   * Runs entity-level validation. Throws EntityValidationError when there are
   * errors.
   * @param {Record<string, *>} input
   * @param {string} operation
   */
  #validate(input, operation) {
    const errors = this.entity.validate(input);
    if (Object.keys(errors).length > 0) {
      throw new EntityValidationError(errors, `${this.entity.name} (${operation})`);
    }
  }

  /**
   * Applies column defaults (static values or functions) for any undefined
   * fields in the input object, mutating it in place.
   * @param {Record<string, *>} input
   */
  #applyDefaults(input) {
    for (const column of this.entity.columnsByField.values()) {
      if (input[column.field] !== undefined) continue;
      if (column.default === undefined) continue;
      input[column.field] =
        typeof column.default === 'function' ? column.default(input) : column.default;
    }
  }

  /**
   * Resolves a relation's foreign key (a field name) to its database column
   * on the owning entity, falling back to the raw value when it is not a
   * declared field.
   *
   * For `hasMany`, the foreign key lives on the *target* entity; for
   * `belongsTo` it lives on this entity.
   * @param {object} rel
   * @param {import('./entity.js').EntityDescriptor} owner - the entity that owns the column
   * @returns {string}
   */
  #fkColumn(rel, owner) {
    const meta = owner.columnsByField.get(rel.foreignKey);
    return meta ? meta.column : rel.foreignKey;
  }

  /**
   * Eager-loads related entities and attaches them to the parent array.
   * Supports both `hasMany` and `belongsTo` relations. Supports deeply nested
   * includes via dot paths, e.g. `'posts.author'`.
   * @param {Array<Record<string, *>>} entities
   * @param {string[]} include
   */
  #eagerLoad(entities, include) {
    // top-level relation names (deduplicated)
    const topLevel = [...new Set(include.map((path) => path.split('.')[0]))];

    for (const relName of topLevel) {
      const rel = this.entity.relations.get(relName);
      if (!rel) throw new Error(`Unknown relation "${relName}" on entity "${this.entity.name}"`);
      const targetRepo = new Repository(rel.target, this.db);
      const pkCol = this.entity.primary.column;

      if (rel.type === 'hasMany') {
        const localPks = [...new Set(entities.map((e) => e[pkCol]))];
        if (localPks.length === 0) continue;
        const fkColumn = this.#fkColumn(rel, rel.target);
        const w = buildWhereIn(fkColumn, localPks);
        const rows = this.db
          .prepare(`SELECT * FROM "${rel.target.table}" ${w.sql}`)
          .all(...w.params);
        const grouped = new Map();
        for (const row of rows) {
          const fkVal = row[fkColumn];
          if (!grouped.has(fkVal)) grouped.set(fkVal, []);
          grouped.get(fkVal).push(rel.target.deserialize(row));
        }
        for (const entity of entities) {
          entity[relName] = grouped.get(entity[pkCol]) ?? [];
        }
      } else if (rel.type === 'belongsTo') {
        const localFks = [
          ...new Set(entities.map((e) => e[rel.foreignKey]).filter((v) => v != null)),
        ];
        if (localFks.length === 0) continue;
        const w = buildWhereIn(pkCol, localFks);
        const rows = this.db
          .prepare(`SELECT * FROM "${rel.target.table}" ${w.sql}`)
          .all(...w.params);
        const byPk = new Map(rows.map((row) => [row[pkCol], rel.target.deserialize(row)]));
        for (const entity of entities) {
          entity[relName] = byPk.get(entity[rel.foreignKey]) ?? null;
        }
      }

      // recurse into nested includes, e.g. 'posts.author' -> 'author'
      const nestedIncludes = include
        .filter((i) => i.startsWith(`${relName}.`))
        .map((i) => i.slice(relName.length + 1));
      if (nestedIncludes.length > 0) {
        const children = entities.flatMap((e) => {
          const v = e[relName];
          return Array.isArray(v) ? v : v == null ? [] : [v];
        });
        if (children.length > 0) targetRepo.#eagerLoad(children, nestedIncludes);
      }
    }
  }
}
