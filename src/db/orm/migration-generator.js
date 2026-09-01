import { buildColumnSql } from './entity.js';
import { Migration } from './migrations.js';

/**
 * Snapshot of a single table's columns from `PRAGMA table_info`.
 * @typedef {object} TableInfoRow
 * @property {string} name
 * @property {string} type
 * @property {number} notnull
 * @property {string | number | null} dflt_value
 * @property {number} pk
 */

/**
 * Reads the current schema of the database: tables, their columns, and their
 * non-auto indexes.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} [skipTables] - tables to ignore (default: ['migrations'])
 * @returns {Map<string, { columns: TableInfoRow[], indexes: Array<{name: string, sql: string}> }>}
 */
export function schemaSnapshot(db, skipTables = ['migrations']) {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name)
    .filter((name) => !skipTables.includes(name));

  const snapshot = new Map();
  for (const table of tables) {
    const columns = /** @type {TableInfoRow[]} */ (db.pragma(`table_info("${table}")`));
    const indexes = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_autoindex_%'`
      )
      .all(table);
    snapshot.set(table, { columns, indexes });
  }
  return snapshot;
}

/**
 * The index declarations an entity expects: single-column indexes from
 * `index: true` / `unique: true` columns plus the `indexes` composite list.
 * @param {import('./entity.js').EntityDescriptor} entity
 * @returns {Array<{ name: string, createSql: string }>}
 */
function entityIndexes(entity) {
  const records = [];
  for (const column of entity.columnsByField.values()) {
    if (column.index || (column.unique && !column.primaryKey)) {
      const name = `idx_${entity.table}_${column.column}`;
      records.push({
        name,
        createSql: `CREATE ${column.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${name}" ON "${entity.table}" ("${column.column}")`,
      });
    }
  }
  for (const idx of entity.indexes) {
    const cols = idx.columns.map((c) => `"${c}"`).join(', ');
    const where = idx.where ? ` WHERE ${idx.where}` : '';
    records.push({
      name: idx.name,
      createSql: `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${idx.name}" ON "${entity.table}" (${cols})${where}`,
    });
  }
  return records;
}

/**
 * Reconstructs an `ADD COLUMN`-style clause for an existing database column
 * (used to rebuild a column in a `down` migration).
 * @param {TableInfoRow} col
 * @returns {string}
 */
function reconstructAddColumn(col) {
  let sql = `"${col.name}" ${col.type}`;
  if (col.notnull) sql += ' NOT NULL';
  if (col.dflt_value !== null && col.dflt_value !== undefined) {
    sql += ` DEFAULT ${col.dflt_value}`;
  }
  return sql;
}

/**
 * Diffs the entity definitions against the current database schema and
 * produces the TypeORM-style `upQueries` / `downQueries` needed to bring the
 * database in sync with the entities.
 *
 * The diff covers tables, columns and indexes:
 *   - tables in the DB that no entity declares are dropped (and recreated in
 *     `down`)
 *   - entity tables missing from the DB are created
 *   - new columns are added, removed columns are dropped
 *   - new indexes are created, stale indexes are dropped
 * @param {import('better-sqlite3').Database} db
 * @param {Array<import('./entity.js').EntityDescriptor>} entities
 * @param {{ skipTables?: string[] }} [opts]
 * @returns {{ upQueries: string[], downQueries: string[] }}
 */
export function diffSchema(db, entities, opts = {}) {
  const snapshot = schemaSnapshot(db, opts.skipTables);
  const byTable = new Map(entities.map((e) => [e.table, e]));

  /** @type {string[]} */
  const up = [];
  /** @type {string[]} */
  const down = [];

  // tables present in the DB but not declared by an entity -> drop
  for (const table of snapshot.keys()) {
    if (byTable.has(table)) continue;
    up.push(`DROP TABLE IF EXISTS "${table}"`);
    const createSql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table)?.sql;
    down.push(`CREATE TABLE IF NOT EXISTS "${table}" (${stripCreateSuffix(createSql)})`);
  }

  for (const entity of entities) {
    const existing = snapshot.get(entity.table);

    if (!existing) {
      // brand-new table (plus its indexes)
      up.push(entity.toCreateTableSql());
      for (const idx of entityIndexes(entity)) {
        up.push(idx.createSql);
      }
      down.push(`DROP TABLE IF EXISTS "${entity.table}"`);
      for (const idx of entityIndexes(entity)) {
        down.push(`DROP INDEX IF EXISTS "${idx.name}"`);
      }
      continue;
    }

    // columns present in the entity but missing in the DB -> add
    const dbColumns = new Map(existing.columns.map((c) => [c.name, c]));

    for (const column of entity.columnsByField.values()) {
      if (dbColumns.has(column.column)) continue;
      up.push(`ALTER TABLE "${entity.table}" ADD COLUMN ${buildColumnSql(column, { add: true })}`);
      down.push(`ALTER TABLE "${entity.table}" DROP COLUMN "${column.column}"`);
    }

    // columns present in the DB but gone from the entity -> drop
    const entityColumns = new Set([...entity.columnsByField.values()].map((c) => c.column));
    for (const col of existing.columns) {
      if (entityColumns.has(col.name)) continue;
      up.push(`ALTER TABLE "${entity.table}" DROP COLUMN "${col.name}"`);
      down.push(`ALTER TABLE "${entity.table}" ADD COLUMN ${reconstructAddColumn(col)}`);
    }

    // indexes declared by the entity but missing in the DB -> create
    const dbIndexes = new Map(existing.indexes.map((i) => [i.name, i]));
    for (const idx of entityIndexes(entity)) {
      if (dbIndexes.has(idx.name)) continue;
      up.push(idx.createSql);
      down.push(`DROP INDEX IF EXISTS "${idx.name}"`);
    }

    // indexes in the DB but no longer declared by the entity -> drop
    const entityIndexNames = new Set(entityIndexes(entity).map((i) => i.name));
    for (const idx of existing.indexes) {
      if (entityIndexNames.has(idx.name)) continue;
      up.push(`DROP INDEX IF EXISTS "${idx.name}"`);
      down.push(idx.sql);
    }
  }

  return { upQueries: up, downQueries: down };
}

/**
 * Strips the leading `CREATE TABLE <name> ` / `CREATE TABLE IF NOT EXISTS
 * <name> ` prefix from a stored CREATE sql so it can be re-embedded inside a
 * fresh `CREATE TABLE IF NOT EXISTS` statement.
 * @param {string | undefined} sql
 * @returns {string}
 */
function stripCreateSuffix(sql) {
  if (!sql) throw new Error('Cannot reverse the drop of a table without its CREATE sql');
  return sql.replace(/^CREATE TABLE (?:IF NOT EXISTS )?"[^"]*" /, '');
}

/**
 * Wraps the diff result in a concrete {@link Migration} subclass. The class
 * runs every up-query in `up` and every down-query (reversed, TypeORM-style)
 * in `down`.
 * @param {{ upQueries: string[], downQueries: string[] }} diff
 * @param {{ name: string, timestamp?: number }} opts
 * @returns {import('./migrations.js').Migration} an instance of a generated class
 */
export function buildMigration(diff, opts) {
  const name = opts.name;
  const timestamp = opts.timestamp ?? Date.now();
  const upQueries = diff.upQueries;
  const downQueries = [...diff.downQueries].reverse();

  const Generated = class extends Migration {
    constructor() {
      super();
      this.name = name;
      this.timestamp = timestamp;
    }

    up(db) {
      for (const sql of upQueries) db.exec(sql);
    }

    down(db) {
      for (const sql of downQueries) db.exec(sql);
    }
  };

  return new Generated();
}

/**
 * Renders an ESM migration file (a class extending `Migration`) ready to be
 * saved to disk, mirroring TypeORM's `migration:generate` output.
 * @param {{ upQueries: string[], downQueries: string[] }} diff
 * @param {{ name: string, timestamp?: number, importPath?: string }} opts
 * @returns {string}
 */
export function renderMigrationFile(diff, opts) {
  const migration = buildMigration(diff, opts);
  const importPath = opts.importPath ?? './src/db/orm/migrations.js';
  const upSqls = diff.upQueries.map((q) => `      db.exec(\`${escapeTemplate(q)}\`);`).join('\n');
  const downSqls = [...diff.downQueries]
    .reverse()
    .map((q) => `      db.exec(\`${escapeTemplate(q)}\`);`)
    .join('\n');

  return `import { Migration } from '${importPath}';

export class ${migration.name} extends Migration {
  constructor() {
    super();
    this.name = '${migration.name}';
    this.timestamp = ${migration.timestamp};
  }

  up(db) {
${upSqls}
  }

  down(db) {
${downSqls}
  }
}
`;
}

/**
 * Escapes a SQL string for embedding inside a template literal.
 * @param {string} sql
 * @returns {string}
 */
function escapeTemplate(sql) {
  return sql.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}
