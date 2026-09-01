import { randomUUID } from 'node:crypto';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { config } from '../config/index.js';

let db = null;
let dbPath = config.databasePath;

/**
 * Configures the database file path used by the next connection.
 * Useful for tests using an isolated or in-memory database.
 * @param {string} path
 */
export function configureDatabasePath(path) {
  dbPath = path;
}

/**
 * Returns the singleton SQLite database connection, creating the schema
 * on first access.
 * @returns {import('better-sqlite3').Database}
 */
export function getDatabase() {
  if (!db) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    db = new Database(dbPath);
    if (dbPath !== ':memory:') {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('foreign_keys = ON');

    initializeSchema(db);
  }
  return db;
}

/**
 * Creates the database tables and indexes if they do not already exist.
 * @param {import('better-sqlite3').Database} database
 */
function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      poll_type TEXT NOT NULL CHECK(poll_type IN ('date', 'weekday', 'datetime')),
      timezone TEXT NOT NULL DEFAULT 'UTC',
      allow_maybe INTEGER NOT NULL DEFAULT 1,
      anonymous_voting INTEGER NOT NULL DEFAULT 1,
      require_identification INTEGER NOT NULL DEFAULT 0,
      max_participants INTEGER,
      expires_at TEXT,
      is_finalized INTEGER NOT NULL DEFAULT 0,
      finalized_at TEXT,
      finalized_slot_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      poll_option_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      response TEXT NOT NULL CHECK(response IN ('yes', 'maybe', 'no')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (poll_option_id) REFERENCES poll_options(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      UNIQUE(poll_option_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      title TEXT,
      author_user_id TEXT NOT NULL,
      chat_id TEXT,
      poll_type TEXT NOT NULL DEFAULT 'datetime',
      selected_dates TEXT NOT NULL DEFAULT '[]',
      time_slots TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_author_user_id ON drafts(author_user_id);

    CREATE TABLE IF NOT EXISTS incoming_messages (
      id TEXT PRIMARY KEY,
      update_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      UNIQUE(update_id)
    );

    CREATE INDEX IF NOT EXISTS idx_incoming_unprocessed
      ON incoming_messages(processed_at);

    CREATE TABLE IF NOT EXISTS outgoing_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      method TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      sent_at TEXT,
      handled_at DATETIME,
      queued_at DATETIME NOT NULL DEFAULT (datetime('now')),
      status_changed_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON poll_options(poll_id);
    CREATE INDEX IF NOT EXISTS idx_votes_option_id ON votes(poll_option_id);
    CREATE INDEX IF NOT EXISTS idx_votes_participant_id ON votes(participant_id);
  `);

  migrateSchema(database);

  // participant indexes are created here so they never reference a stale
  // pre-migration participants table.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_participants_poll_id ON participants(poll_id);
    CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_outgoing_pending
      ON outgoing_messages(status, queued_at);
  `);
}

/**
 * Applies schema migrations based on the stored PRAGMA user_version.
 * @param {import('better-sqlite3').Database} database
 */
function migrateSchema(database) {
  // Participants must reference a user account and must not carry identity
  // columns directly. Recreate the table if it still has a legacy shape
  // (name/email/session_id columns, or a nullable user_id).
  const pCols = database
    .prepare('PRAGMA table_info(participants)')
    .all()
    .map((c) => c.name);
  const userColNullable = database
    .prepare('PRAGMA table_info(participants)')
    .all()
    .some((c) => c.name === 'user_id' && !c.notnull);
  const participantsLegacy =
    pCols.includes('name') ||
    pCols.includes('email') ||
    pCols.includes('session_id') ||
    userColNullable;

  if (participantsLegacy) {
    database.exec(`
      DROP TABLE IF EXISTS participants;
      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  // Users must not store a session_id directly; it lives in its own table.
  const uCols = database
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name);
  if (uCols.includes('session_id')) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);

    const rows = database
      .prepare('SELECT id, session_id FROM users WHERE session_id IS NOT NULL')
      .all();
    const insert = database.prepare(
      "INSERT OR IGNORE INTO sessions (id, user_id, session_id, created_at) VALUES (?, ?, ?, datetime('now'))"
    );
    for (const row of rows) {
      insert.run(randomUUID(), row.id, row.session_id);
    }

    database.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users_v4 (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_v4 (id, name, email, created_at, updated_at)
        SELECT id, name, email, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v4 RENAME TO users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      PRAGMA foreign_keys = ON;
    `);
  }

  // Outbox rows use domain-specific timestamp columns: queued_at (when the
  // request was enqueued), status_changed_at (last state change), and
  // handled_at (when the dispatcher finished with the message), all stored as
  // DATETIME so handling duration can be measured as handled_at - queued_at.
  // Older databases used generic created_at / updated_at TEXT columns, so
  // recreate the table in the current shape while preserving data.
  const outboxCols = database
    .prepare('PRAGMA table_info(outgoing_messages)')
    .all()
    .map((c) => c.name);
  if (!outboxCols.includes('queued_at')) {
    const handledAt = outboxCols.includes('handled_at') ? 'handled_at' : 'NULL';
    database.exec(`
      DROP INDEX IF EXISTS idx_outgoing_pending;
      CREATE TABLE outgoing_messages_v6 (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        method TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        sent_at TEXT,
        handled_at DATETIME,
        queued_at DATETIME NOT NULL DEFAULT (datetime('now')),
        status_changed_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO outgoing_messages_v6
        (id, chat_id, method, payload, status, attempts, error, sent_at, handled_at, queued_at, status_changed_at)
      SELECT
        id, chat_id, method, payload, status, attempts, error, sent_at, ${handledAt}, created_at, updated_at
      FROM outgoing_messages;
      DROP TABLE outgoing_messages;
      ALTER TABLE outgoing_messages_v6 RENAME TO outgoing_messages;
    `);
  }

  database.pragma('user_version = 7');
}

/**
 * Closes the database connection and resets the singleton.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Generates a new unique identifier using the native Node.js crypto module.
 * @returns {string}
 */
export function generateId() {
  return randomUUID();
}
