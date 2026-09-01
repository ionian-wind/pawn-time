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

  /** @type {import('../../db/base-repository.entity.js').ColumnConfig[]} */
  static COLUMNS = [
    { field: 'chatId', column: 'chat_id' },
    { field: 'method', column: 'method' },
    { field: 'payload', column: 'payload' },
  ];

  /**
   * Queues an outbound API call in the outbox.
   * @param {string} chatId
   * @param {string} method - the Telegram API method (e.g. "sendMessage")
   * @param {object} payload - the request parameters (already JSON-serializable)
   * @returns {import('./message.entity.js').OutgoingMessage}
   */
  static record(chatId, method, payload) {
    return this.create({ chatId, method, payload: JSON.stringify(payload) });
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
         LIMIT ?`
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
    const result = db
      .prepare(
        `UPDATE ${this.TABLE}
         SET status = 'sent', attempts = attempts + 1,
             error = NULL, sent_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(new Date().toISOString(), new Date().toISOString(), id);
    return result.changes > 0;
  }

  /**
   * Records a failed attempt and bumps the retry counter. Pass `giveUp = true`
   * to permanently fail the message instead of leaving it pending for retry.
   * @param {string} id
   * @param {string} error
   * @param {{ giveUp?: boolean }} [options]
   * @returns {import('./message.entity.js').OutgoingMessage | null}
   */
  static markFailed(id, error, options = {}) {
    const db = getDatabase();
    const status = options.giveUp ? 'failed' : 'pending';
    db.prepare(
      `UPDATE ${this.TABLE}
       SET status = ?, attempts = attempts + 1, error = ?,
           sent_at = NULL, updated_at = ?
       WHERE id = ?`
    ).run(status, error, new Date().toISOString(), id);
    return this.findById(id);
  }

  /** @param {any} row */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      chatId: row.chat_id,
      method: row.method,
      payload: JSON.parse(row.payload),
      status: row.status,
      attempts: row.attempts,
      error: row.error,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    };
  }
}
