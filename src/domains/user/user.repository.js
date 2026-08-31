import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase, generateId } from '../../db/database.js';

/**
 * Repository for users.
 */
export class UserRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'users';

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'name', column: 'name' },
    { field: 'email', column: 'email' },
  ];

  /**
   * Finds a user by email.
   * @param {string} email
   * @returns {import('./user.entity.js').User | null}
   */
  static findByEmail(email) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Finds a user by session id, delegating to the sessions table.
   * @param {string} sessionId
   * @returns {import('./user.entity.js').User | null}
   */
  static findBySessionId(sessionId) {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN sessions s ON s.user_id = u.id
         WHERE s.session_id = ?`
      )
      .get(sessionId);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Returns all sessions associated with a user.
   * @param {string} userId
   * @returns {Array<import('./user.entity.js').Session>}
   */
  static findSessionsByUser(userId) {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(userId);
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
  }

  /**
   * Links a session to a user account.
   * @param {string} userId
   * @param {string} sessionId
   * @returns {import('./user.entity.js').Session | null}
   */
  static addSession(userId, sessionId) {
    if (!sessionId) return null;
    const db = getDatabase();
    const id = generateId();
    db.prepare(
      "INSERT OR IGNORE INTO sessions (id, user_id, session_id, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(id, userId, sessionId);
    return this.findSession(sessionId);
  }

  /**
   * Finds a session record by its session id.
   * @param {string} sessionId
   * @returns {import('./user.entity.js').Session | null}
   */
  static findSession(sessionId) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
    return row
      ? { id: row.id, userId: row.user_id, sessionId: row.session_id, createdAt: row.created_at }
      : null;
  }

  /**
   * Finds a user by email, creating a new one if it does not exist.
   * @param {import('./user.entity.js').CreateUserInput} input
   * @returns {import('./user.entity.js').User}
   */
  static findOrCreateByEmail(input) {
    if (input.email) {
      const existing = this.findByEmail(input.email);
      if (existing) return existing;
    }
    return this.create(input);
  }

  /**
   * Resolves a user for a session, creating one on demand if it does not exist.
   * Every participant requires a user account, so a session always resolves to
   * a user. When identifying info (email) is provided, an existing user matched
   * by email is reused and the session is linked to the same account, achieving
   * cross-device dedup.
   * @param {import('./user.entity.js').CreateUserInput} input
   * @param {string} sessionId
   * @returns {import('./user.entity.js').User}
   */
  static findOrCreateBySession(input, sessionId) {
    if (sessionId) {
      const existing = this.findBySessionId(sessionId);
      if (existing) {
        return this.mergeInfo(existing, input);
      }
    }

    if (input.email) {
      const existing = this.findByEmail(input.email);
      if (existing) {
        this.addSession(existing.id, sessionId);
        return this.mergeInfo(existing, input);
      }
    }

    const user = this.create(input);
    this.addSession(user.id, sessionId);
    return user;
  }

  /**
   * Applies provided identifying info (name/email) to an existing user when
   * it is missing or changed.
   * @param {import('./user.entity.js').User} user
   * @param {import('./user.entity.js').CreateUserInput} input
   * @returns {import('./user.entity.js').User}
   */
  static mergeInfo(user, input) {
    const updates = {};
    if (input.name !== undefined && input.name !== user.name) updates.name = input.name;
    if (input.email !== undefined && input.email !== user.email) updates.email = input.email;

    if (Object.keys(updates).length > 0) {
      return this.update(user.id, updates) ?? user;
    }
    return user;
  }

  /**
   * Maps a raw database row to a User object.
   * @param {any} row
   * @returns {import('./user.entity.js').User}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
