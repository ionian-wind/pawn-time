import { getDatabase, generateId } from './database.js';

/**
 * Provides shared data-access behaviour for domain repositories.
 *
 * Subclasses extend this class and declare static metadata so the generic
 * methods (create / findById / update / delete / findMany) know how to map
 * entity rows and columns:
 *
 *   - `static TABLE`           : database table name (required)
 *   - `static COLUMNS`         : array of column configs for create/update
 *   - `static mapRowToEntity(row)` : row -> entity mapper (required)
 *   - `static HAS_UPDATED_AT`  : whether the table has an updated_at column
 *   - `static CREATED_AT_COLUMN` / `UPDATED_AT_COLUMN` : timestamp column
 *     names; a repository can override these with domain terms (e.g. the
 *     outbox uses `queued_at` / `status_changed_at`)
 *
 * Static methods are invoked with `this` bound to the subclass, so each
 * repository operates on its own table without duplicating logic.
 */
export class BaseRepository {
  /** @type {string|null} */
  static TABLE = null;

  /** @type {boolean} */
  static HAS_UPDATED_AT = true;

  /** @type {string} */
  static CREATED_AT_COLUMN = 'created_at';

  /** @type {string} */
  static UPDATED_AT_COLUMN = 'updated_at';

  /**
   * Current timestamp as an ISO string.
   * @returns {string}
   */
  static now() {
    return new Date().toISOString();
  }

  /**
   * Coerces a raw value for a column, converting booleans to 1/0.
   * @param {import('./base-repository.entity.js').ColumnConfig} config
   * @param {*} value
   * @returns {*}
   */
  static coerceValue(config, value) {
    if (config.type === 'bool') return value ? 1 : 0;
    return value;
  }

  /**
   * Resolves the value used when inserting a row for the given column.
   * @param {import('./base-repository.entity.js').ColumnConfig} config
   * @param {*} value
   * @returns {*}
   */
  static valueForCreate(config, value) {
    if (value === undefined) return this.coerceValue(config, config.insertDefault ?? null);
    if (value === null) return null;
    return this.coerceValue(config, value);
  }

  /**
   * Creates a row in the repository's table.
   * @param {Object<string, *>} input
   * @returns {*}
   */
  static create(input) {
    const db = getDatabase();
    const id = generateId();
    const now = this.now();

    /** @type {string[]} */
    const columns = ['id', ...this.COLUMNS.map((c) => c.column)];
    /** @type {any[]} */
    const values = [id, ...this.COLUMNS.map((c) => this.valueForCreate(c, input[c.field]))];

    columns.push(this.CREATED_AT_COLUMN);
    values.push(now);
    if (this.HAS_UPDATED_AT) {
      columns.push(this.UPDATED_AT_COLUMN);
      values.push(now);
    }

    db.prepare(
      `INSERT INTO ${this.TABLE} (${columns.join(', ')}) VALUES (${columns
        .map(() => '?')
        .join(', ')})`
    ).run(...values);

    return this.findById(id);
  }

  /**
   * Finds a row by id.
   * @param {string} id
   * @returns {* | null}
   */
  static findById(id) {
    if (!id) return null;
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM ${this.TABLE} WHERE id = ?`).get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Runs a SELECT with a WHERE clause and maps each row.
   * @param {string} where - e.g. "poll_id = ? AND user_id = ?"
   * @param {any[]} [params]
   * @param {string} [orderBy]
   * @returns {Array<*>}
   */
  static findMany(where, params = [], orderBy = '') {
    const db = getDatabase();
    const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';
    const rows = db
      .prepare(`SELECT * FROM ${this.TABLE} WHERE ${where}${orderClause}`)
      .all(...params);
    return rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Runs a SELECT returning a single mapped row.
   * @param {string} where - e.g. "poll_id = ? AND user_id = ?"
   * @param {any[]} [params]
   * @returns {* | null}
   */
  static findOne(where, params = []) {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM ${this.TABLE} WHERE ${where}`).get(...params);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Updates the provided fields of a row, based on the column configs.
   * @param {string} id
   * @param {Object<string, *>} data
   * @returns {* | null}
   */
  static update(id, data) {
    const db = getDatabase();
    const existing = this.findById(id);
    if (!existing) return null;

    /** @type {string[]} */
    const fields = [];
    /** @type {any[]} */
    const values = [];

    for (const config of this.COLUMNS) {
      if (data[config.field] === undefined) continue;
      fields.push(`${config.column} = ?`);
      values.push(this.coerceValue(config, data[config.field]));
    }

    if (fields.length === 0) return existing;

    if (this.HAS_UPDATED_AT) {
      fields.push(`${this.UPDATED_AT_COLUMN} = ?`);
      values.push(this.now());
    }
    values.push(id);

    db.prepare(`UPDATE ${this.TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  /**
   * Deletes a row by id.
   * @param {string} id
   * @returns {boolean}
   */
  static delete(id) {
    const db = getDatabase();
    const result = db.prepare(`DELETE FROM ${this.TABLE} WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}
