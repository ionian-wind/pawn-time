import { createHash } from 'node:crypto';

import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase } from '../../db/database.js';

/**
 * Outbox of outbound Telegram API requests. Every message the bot wants to send
 * is first recorded here and drained to the real API by the dispatcher, so a
 * restart never drops a send. `status` transitions pending -> sent (success) or
 * pending -> failed (permanent error after retries).
 */
export class OutboxRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'outgoing_messages';

  /** @type {boolean} */
  static HAS_UPDATED_AT = true;

  /** @type {string} */
  static CREATED_AT_COLUMN = 'queued_at';

  /** @type {string} */
  static UPDATED_AT_COLUMN = 'status_changed_at';

  /** @type {import('../../db/base-repository.entity.js').ColumnConfig[]} */
  static COLUMNS = [
    { field: 'chatId', column: 'chat_id' },
    { field: 'method', column: 'method' },
    { field: 'payload', column: 'payload' },
    { field: 'fingerprint', column: 'fingerprint' },
  ];

  /**
   * Computes a stable fingerprint for an outgoing API call from the method and
   * a canonical serialization of its payload. Two identical logical calls
   * produce the same fingerprint, which is used to detect (and skip) retries
   * of a message that was already delivered.
   * @param {string} method
   * @param {object} payload
   * @returns {string}
   */
  static computeFingerprint(method, payload) {
    const canonical = canonicalize(payload);
    return createHash('sha256').update(`${method}\n${canonical}`).digest('hex');
  }

  /**
   * Queues an outbound API call in the outbox.
   * @param {string} chatId
   * @param {string} method - the Telegram API method (e.g. "sendMessage")
   * @param {object} payload - the request parameters (already JSON-serializable)
   * @returns {import('./message.entity.js').OutgoingMessage}
   */
  static record(chatId, method, payload) {
    const fingerprint = this.computeFingerprint(method, payload);
    return this.create({ chatId, method, payload: JSON.stringify(payload), fingerprint });
  }

  /**
   * Returns a successfully sent row whose fingerprint matches `fingerprint`,
   * or null if none. Used to tell whether a pending retry was already
   * delivered to Telegram (e.g. the original response was lost on a laggy
   * connection) so it can be skipped instead of double-sent.
   * @param {string} fingerprint
   * @returns {import('./message.entity.js').OutgoingMessage | null}
   */
  static findSentByFingerprint(fingerprint) {
    if (fingerprint == null) return null;
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${this.TABLE}
         WHERE fingerprint = ? AND status = 'sent'
         ORDER BY rowid ASC
         LIMIT 1`,
      )
      .get(fingerprint);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Returns the oldest pending messages, oldest first, up to `limit`.
   * @param {number} [limit]
   * @returns {Array<import('./message.entity.js').OutgoingMessage>}
   */
  static listPending(limit = 100) {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${this.TABLE}
         WHERE status = 'pending'
         ORDER BY rowid ASC
         LIMIT ?`,
      )
      .all(limit);
    return rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Marks a message as successfully sent.
   * @param {string} id
   * @returns {boolean}
   */
  static markSent(id) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE ${this.TABLE}
         SET status = 'sent', attempts = attempts + 1,
             error = NULL, sent_at = ?, handled_at = ?, ${this.UPDATED_AT_COLUMN} = ?
         WHERE id = ?`,
      )
      .run(now, now, now, id);
    return result.changes > 0;
  }

  /**
   * Records a failed attempt and bumps the retry counter. Pass `giveUp = true`
   * to permanently fail the message instead of leaving it pending for retry.
   * Only a permanent failure marks the message as handled.
   * @param {string} id
   * @param {string} error
   * @param {{ giveUp?: boolean }} [options]
   * @returns {import('./message.entity.js').OutgoingMessage | null}
   */
  static markFailed(id, error, options = {}) {
    const db = getDatabase();
    const status = options.giveUp ? 'failed' : 'pending';
    const handledAt = options.giveUp ? new Date().toISOString() : null;
    db.prepare(
      `UPDATE ${this.TABLE}
       SET status = ?, attempts = attempts + 1, error = ?,
           sent_at = NULL, handled_at = ?, ${this.UPDATED_AT_COLUMN} = ?
       WHERE id = ?`,
    ).run(status, error, handledAt, new Date().toISOString(), id);
    return this.findById(id);
  }

  /** @param {any} row */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      chatId: row.chat_id,
      method: row.method,
      payload: JSON.parse(row.payload),
      fingerprint: row.fingerprint ?? null,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
      queuedAt: row.queued_at,
      sentAt: row.sent_at,
      handledAt: row.handled_at,
      statusChangedAt: row.status_changed_at,
    };
  }
}

/**
 * Serializes a payload into a stable, order-independent string so that two
 * calls with the same logical content (but possibly different key order)
 * hash identically. Nested objects and arrays are handled recursively.
 * @param {*} value
 * @returns {string}
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
