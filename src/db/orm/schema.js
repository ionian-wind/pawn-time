/**
 * Creates all tables and indexes declared by the given entity descriptors.
 * Safe to call multiple times (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX
 * IF NOT EXISTS`).
 * @param {import('better-sqlite3').Database} db
 * @param {Array<import('./entity.js').EntityDescriptor>} entities
 */
export function createSchema(db, entities) {
  const statements = [];
  for (const entity of entities) {
    statements.push(entity.toCreateTableSql());
    statements.push(...entity.toIndexSql());
  }
  for (const sql of statements) {
    db.exec(sql);
  }
}

/**
 * Drops all tables declared by the given entities (for test teardown).
 * Foreign keys are disabled during the drop to avoid cascading errors.
 * @param {import('better-sqlite3').Database} db
 * @param {Array<import('./entity.js').EntityDescriptor>} entities
 */
export function dropSchema(db, entities) {
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const entity of entities) {
    db.exec(`DROP TABLE IF EXISTS "${entity.table}";`);
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

/**
 * Returns the current table info (column names, types, nullable) as reported
 * by SQLite. Useful in tests to assert on the schema shape.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @returns {Array<object>}
 */
export function tableInfo(db, table) {
  return db.pragma(`table_info("${table}")`);
}
