import { transactionFor } from './transaction.js';

/**
 * Base class for database migrations, mirroring TypeORM's
 * `MigrationInterface`. Subclasses set `name` and `timestamp` and implement
 * `up` / `down`, each receiving the `better-sqlite3` database handle.
 * @example
 * export class CreateUsersTable extends Migration {
 *   constructor() {
 *     super();
 *     this.name = 'CreateUsersTable';
 *     this.timestamp = 1690000000000;
 *   }
 *   up(db) {
 *     db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
 *   }
 *   down(db) {
 *     db.exec(`DROP TABLE IF EXISTS users`);
 *   }
 * }
 */
export class Migration {
  constructor() {
    /** @type {string} */
    this.name = this.constructor.name;
    /** @type {number} */
    this.timestamp = Date.now();
  }

  /**
   * Applies the migration. Subclasses receive the database handle.
   */
  up() {
    throw new Error(`Migration "${this.name}" does not implement up()`);
  }

  /**
   * Reverts the migration. Subclasses receive the database handle.
   */
  down() {
    throw new Error(`Migration "${this.name}" does not implement down()`);
  }
}

/**
 * Runs {@link Migration} classes against a database, tracking which have been
 * applied in a `migrations` meta table. Each migration `up` / `down` block is
 * executed inside its own transaction; if it throws, the transaction (and the
 * tracking record) is rolled back.
 */
export class MigrationRunner {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {{ table?: string }} [opts]
   */
  constructor(db, opts = {}) {
    /** @type {import('better-sqlite3').Database} */
    this.db = db;
    /** @type {string} */
    this.table = opts.table ?? 'migrations';
  }

  /**
   * Creates the migrations tracking table if it does not exist.
   * @returns {this}
   */
  ensureTable() {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS "${this.table}" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "name" TEXT NOT NULL UNIQUE,
         "timestamp" INTEGER NOT NULL
       )`
    );
    return this;
  }

  /**
   * Returns the applied migration records, newest first.
   * @returns {Array<{ id: number, name: string, timestamp: number }>}
   */
  applied() {
    this.ensureTable();
    return this.db
      .prepare(`SELECT id, name, timestamp FROM "${this.table}" ORDER BY timestamp DESC, id DESC`)
      .all();
  }

  /**
   * Returns the migrations that have not yet been applied, ordered by
   * `timestamp` ascending.
   * @param {Array<Migration>} migrations
   * @returns {Array<Migration>}
   */
  pending(migrations) {
    const appliedNames = new Set(this.applied().map((r) => r.name));
    return [...migrations]
      .filter((m) => !appliedNames.has(m.name))
      .sort((a, b) => a.timestamp - b.timestamp || a.name.localeCompare(b.name));
  }

  /**
   * Runs all pending migrations `up`, each inside its own transaction.
   * @param {Array<Migration>} migrations
   * @returns {Array<Migration>} the migrations that were run
   */
  up(migrations) {
    this.ensureTable();
    const ran = [];
    for (const migration of this.pending(migrations)) {
      const record = () =>
        this.db
          .prepare(`INSERT INTO "${this.table}" (name, timestamp) VALUES (?, ?)`)
          .run(migration.name, migration.timestamp);
      transactionFor(this.db).run(() => {
        migration.up(this.db);
        record();
      });
      ran.push(migration);
    }
    return ran;
  }

  /**
   * Reverts the most recent `steps` applied migrations by calling their
   * `down` method, each inside its own transaction.
   * @param {Array<Migration>} migrations
   * @param {number} [steps] - how many migrations to revert (default 1)
   * @returns {Array<Migration>} the migrations that were reverted
   */
  down(migrations, steps = 1) {
    this.ensureTable();
    const byName = new Map(migrations.map((m) => [m.name, m]));
    const toRevert = this.applied().slice(0, steps);
    const reverted = [];
    for (const { name } of toRevert) {
      const migration = byName.get(name);
      if (!migration) {
        throw new Error(`No migration class found for applied migration "${name}"`);
      }
      transactionFor(this.db).run(() => {
        migration.down(this.db);
        this.db.prepare(`DELETE FROM "${this.table}" WHERE name = ?`).run(name);
      });
      reverted.push(migration);
    }
    return reverted;
  }
}
