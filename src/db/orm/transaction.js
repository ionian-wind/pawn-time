/**
 * Savepoint-based transaction management for `better-sqlite3`.
 *
 * A top-level transaction uses `BEGIN` / `COMMIT` / `ROLLBACK`. Nested
 * transactions use `SAVEPOINT` / `RELEASE` so inner transaction blocks may be
 * rolled back without aborting the outer transaction.
 *
 * One {@link Transaction} instance manages nesting for a single database
 * connection (the ordering of begins/commits must be strictly LIFO).
 */

/** Tracks the active {@link Transaction} per database connection. */
const active = new WeakMap();

/**
 * Returns the {@link Transaction} manager for a database, creating one on
 * first use.
 * @param {import('better-sqlite3').Database} db
 * @returns {Transaction}
 */
export function transactionFor(db) {
  let tx = active.get(db);
  if (!tx) {
    tx = new Transaction(db);
    active.set(db, tx);
  }
  return tx;
}

let savepointCounter = 0;

/**
 * Manages (possibly nested) transactions on a single connection.
 */
export class Transaction {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    /** @type {import('better-sqlite3').Database} */
    this.db = db;
    /** @type {number} */
    this.depth = 0;
  }

  /**
   * Begins a new transaction (or savepoint when already inside one).
   * @returns {string} name of the started savepoint, or null at top level
   */
  begin() {
    if (this.depth > 0) {
      const name = `savepoint_${++savepointCounter}`;
      this.db.exec(`SAVEPOINT "${name}";`);
      this.depth += 1;
      return name;
    }
    this.db.exec('BEGIN;');
    this.depth = 1;
    return null;
  }

  /**
   * Commits the current level, releasing its savepoint when nested.
   * @param {string} [name] savepoint to release (must match the last begin)
   */
  commit(name) {
    if (this.depth <= 0) throw new Error('commit without a transaction');
    if (name) {
      this.db.exec(`RELEASE "${name}";`);
      this.depth -= 1;
      return;
    }
    this.db.exec('COMMIT;');
    this.depth = 0;
  }

  /**
   * Rolls back the current level, undoing work since the matching begin.
   * @param {string} [name] savepoint to roll back (must match the last begin)
   */
  rollback(name) {
    if (this.depth <= 0) throw new Error('rollback without a transaction');
    if (name) {
      this.db.exec(`ROLLBACK TO "${name}";`);
      this.db.exec(`RELEASE "${name}";`);
      this.depth -= 1;
      return;
    }
    this.db.exec('ROLLBACK;');
    this.depth = 0;
  }

  /**
   * Runs `fn` inside a transaction (new or nested). The transaction is
   * committed on success and rolled back when `fn` throws; the error is
   * re-thrown.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  run(fn) {
    const name = this.begin();
    try {
      const result = fn();
      this.commit(name);
      return result;
    } catch (err) {
      if (this.depth > 0) this.rollback(name);
      throw err;
    }
  }

  /**
   * True when a transaction is currently active on this connection.
   * @returns {boolean}
   */
  inTransaction() {
    return this.depth > 0;
  }
}

/**
 * Runs `fn` inside a transaction on the given database connection. Nested
 * calls are supported through savepoints.
 * @template T
 * @param {import('better-sqlite3').Database} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  return transactionFor(db).run(fn);
}
