import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase } from '../../db/database.js';

/**
 * Repository for polls (data access layer).
 */
export class PollRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'polls';

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'title', column: 'title' },
    { field: 'description', column: 'description' },
    { field: 'location', column: 'location' },
    { field: 'pollType', column: 'poll_type' },
    { field: 'timezone', column: 'timezone', insertDefault: 'UTC' },
    { field: 'allowMaybe', column: 'allow_maybe', type: 'bool', insertDefault: true },
    { field: 'anonymousVoting', column: 'anonymous_voting', type: 'bool', insertDefault: true },
    {
      field: 'requireIdentification',
      column: 'require_identification',
      type: 'bool',
      insertDefault: false,
    },
    { field: 'maxParticipants', column: 'max_participants' },
    { field: 'expiresAt', column: 'expires_at' },
  ];

  /**
   * Lists polls ordered by creation date (descending).
   * @param {number} [limit]
   * @param {number} [offset]
   * @returns {Array<import('./poll.entity.js').Poll>}
   */
  static findMany(limit = 100, offset = 0) {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
    return rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Marks a poll as finalized and records the chosen slot.
   * @param {string} id
   * @param {string} slotId
   * @returns {import('./poll.entity.js').Poll | null}
   */
  static finalize(id, slotId) {
    const db = getDatabase();
    const now = this.now();

    const stmt = db.prepare(`
      UPDATE polls
      SET is_finalized = 1, finalized_at = ?, finalized_slot_id = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(now, slotId, now, id);
    return this.findById(id);
  }

  /**
   * Returns all polls that have expired and have not yet been finalized.
   * @returns {Array<import('./poll.entity.js').Poll>}
   */
  static findExpired() {
    const db = getDatabase();
    const now = this.now();
    const rows = db
      .prepare(
        'SELECT * FROM polls WHERE expires_at IS NOT NULL AND expires_at < ? AND is_finalized = 0'
      )
      .all(now);
    return rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Returns a poll together with its options, participant count and vote counts.
   * Aggregates across the poll, poll_options, participants and votes tables.
   * @param {string} id
   * @returns {import('./poll.entity.js').PollWithStats | null}
   */
  static getWithStats(id) {
    const db = getDatabase();
    const poll = this.findById(id);
    if (!poll) return null;

    const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ?').all(id);

    const participantCount = db
      .prepare('SELECT COUNT(*) as count FROM participants WHERE poll_id = ?')
      .get(id).count;

    const voteCountsRow = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN v.response = 'yes' THEN 1 ELSE 0 END) as yes,
          SUM(CASE WHEN v.response = 'maybe' THEN 1 ELSE 0 END) as maybe,
          SUM(CASE WHEN v.response = 'no' THEN 1 ELSE 0 END) as no
        FROM votes v
        JOIN poll_options po ON v.poll_option_id = po.id
        WHERE po.poll_id = ?
      `
      )
      .get(id);

    return {
      ...poll,
      options: options.map((opt) => ({
        id: opt.id,
        pollId: opt.poll_id,
        date: opt.date,
        startTime: opt.start_time,
        endTime: opt.end_time,
        weekday: opt.weekday,
        createdAt: opt.created_at,
      })),
      participantCount,
      voteCounts: {
        yes: voteCountsRow.yes ?? 0,
        maybe: voteCountsRow.maybe ?? 0,
        no: voteCountsRow.no ?? 0,
      },
    };
  }

  /**
   * Maps a raw database row to a Poll object.
   * @param {any} row
   * @returns {import('./poll.entity.js').Poll}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      pollType: row.poll_type,
      timezone: row.timezone,
      allowMaybe: row.allow_maybe === 1,
      anonymousVoting: row.anonymous_voting === 1,
      requireIdentification: row.require_identification === 1,
      maxParticipants: row.max_participants,
      expiresAt: row.expires_at,
      isFinalized: row.is_finalized === 1,
      finalizedAt: row.finalized_at,
      finalizedSlotId: row.finalized_slot_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
