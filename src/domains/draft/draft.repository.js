import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase } from '../../db/database.js';

/**
 * Repository for drafts (data access layer).
 *
 * Drafts are private: they are keyed by author and never exposed to other
 * users. The BaseRepository generic create/update/delete/findById are used,
 * plus entity-specific lookups by author below.
 */
export class DraftRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'drafts';

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'title', column: 'title' },
    { field: 'authorUserId', column: 'author_user_id' },
    { field: 'chatId', column: 'chat_id' },
    { field: 'pollType', column: 'poll_type', insertDefault: 'datetime' },
    { field: 'selectedDates', column: 'selected_dates', insertDefault: '[]' },
    { field: 'timeSlots', column: 'time_slots', insertDefault: '[]' },
  ];

  /**
   * Creates a draft, serializing the JSON columns for storage.
   * @param {import('./draft.entity.js').CreateDraftInput} input
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static create(input) {
    return super.create(this.#withStoredArrays(input));
  }

  /**
   * Updates a draft, serializing the JSON columns for storage.
   * @param {string} id
   * @param {Partial<import('./draft.entity.js').CreateDraftInput>} data
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static update(id, data) {
    return super.update(id, this.#withStoredArrays(data));
  }

  /**
   * Rewrites the array fields into their JSON string column representation.
   * @param {object} input
   * @returns {object}
   */
  static #withStoredArrays(input) {
    const stored = { ...input };
    if (stored.selectedDates !== undefined) {
      stored.selectedDates = JSON.stringify(stored.selectedDates);
    }
    if (stored.timeSlots !== undefined) {
      stored.timeSlots = JSON.stringify(stored.timeSlots);
    }
    return stored;
  }

  /**
   * Finds drafts owned by a given author, most recent first.
   * @param {string} authorUserId
   * @returns {Array<import('./draft.entity.js').Draft>}
   */
  static findByAuthor(authorUserId) {
    return this.findMany('author_user_id = ?', [authorUserId], 'created_at DESC');
  }

  /**
   * Returns a draft only if it is owned by the given author.
   * @param {string} id
   * @param {string} authorUserId
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static findByAuthorAndId(id, authorUserId) {
    return this.findOne('id = ? AND author_user_id = ?', [id, authorUserId]);
  }

  /**
   * Deletes every draft owned by the given author.
   * @param {string} authorUserId
   * @returns {number} the number of removed drafts
   */
  static deleteByAuthor(authorUserId) {
    return getDatabase()
      .prepare(`DELETE FROM ${this.TABLE} WHERE author_user_id = ?`)
      .run(authorUserId).changes;
  }

  /**
   * Maps a raw database row to a Draft object, decoding the JSON columns.
   * @param {any} row
   * @returns {import('./draft.entity.js').Draft}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      title: row.title,
      authorUserId: row.author_user_id,
      chatId: row.chat_id,
      pollType: row.poll_type,
      selectedDates: parseJsonArray(row.selected_dates),
      timeSlots: parseJsonArray(row.time_slots),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Decodes a JSON array column, returning an empty array if it is missing or
 * malformed.
 * @param {string | null} raw
 * @returns {Array<*>}
 */
function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
