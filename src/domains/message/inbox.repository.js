import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase, generateId } from '../../db/database.js';

/**
 * Inbox of Telegram updates. Updates are persisted as they arrive so nothing is
 * lost across a restart; the pipeline marks a row `processedAt` only after the
 * update has been fully handled.
 */
export class InboxRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'incoming_messages';

  /** @type {false} */
  static HAS_UPDATED_AT = false;

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'updateId', column: 'update_id' },
    { field: 'payload', column: 'payload' },
  ];

  /**
   * Persists an incoming Telegram update, keyed by its update_id so duplicate
   * deliveries are ignored.
   * @param {number} updateId
   * @param {object} payload
   * @returns {import('./message.entity.js').IncomingMessage | null} the stored
   *   row, or null when an update with the same update_id was already received
   */
  static record(updateId, payload) {
    const db = getDatabase();
    const id = generateId();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO incoming_messages (id, update_id, payload, received_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, updateId, JSON.stringify(payload), new Date().toISOString());
    return result.changes > 0 ? this.findById(id) : null;
  }

  /**
   * Returns the oldest unprocessed updates, oldest first.
   * @param {number} [limit]
   * @returns {Array<import('./message.entity.js').IncomingMessage>}
   */
  static listUnprocessed(limit = 100) {
    return this.findMany('processed_at IS NULL', [], 'received_at ASC, rowid ASC').slice(0, limit);
  }

  /**
   * Marks a stored update as processed.
   * @param {string} id
   * @param {string} [processedAt]
   * @returns {boolean}
   */
  static markProcessed(id, processedAt = new Date().toISOString()) {
    const db = getDatabase();
    const result = db
      .prepare('UPDATE incoming_messages SET processed_at = ? WHERE id = ?')
      .run(processedAt, id);
    return result.changes > 0;
  }

  /** @param {any} row */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      updateId: row.update_id,
      payload: JSON.parse(row.payload),
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    };
  }
}
