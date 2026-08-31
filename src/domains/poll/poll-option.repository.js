import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase } from '../../db/database.js';

/**
 * Repository for poll options (slot definitions).
 */
export class PollOptionRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'poll_options';

  /** @type {boolean} */
  static HAS_UPDATED_AT = false;

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'pollId', column: 'poll_id' },
    { field: 'date', column: 'date' },
    { field: 'startTime', column: 'start_time' },
    { field: 'endTime', column: 'end_time' },
    { field: 'weekday', column: 'weekday' },
  ];

  /**
   * Creates multiple poll options in a single transaction.
   * @param {Array<import('./poll.entity.js').CreatePollOptionInput>} inputs
   * @returns {Array<import('./poll.entity.js').PollOption>}
   */
  static createMany(inputs) {
    const db = getDatabase();
    const insertMany = db.transaction((items) => items.map((i) => this.create(i)));
    return insertMany(inputs);
  }

  /**
   * Lists all options belonging to a poll, ordered by date then start time.
   * @param {string} pollId
   * @returns {Array<import('./poll.entity.js').PollOption>}
   */
  static findByPollId(pollId) {
    return this.findMany('poll_id = ?', [pollId], 'date, start_time');
  }

  /**
   * Deletes all options belonging to a poll.
   * @param {string} pollId
   * @returns {boolean}
   */
  static deleteByPollId(pollId) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(pollId);
    return result.changes > 0;
  }

  /**
   * Returns a poll option together with its votes and vote summary.
   * Aggregates across the poll_options and votes tables.
   * @param {string} id
   * @returns {import('./poll.entity.js').PollOptionWithVotes | null}
   */
  static getWithVotes(id) {
    const db = getDatabase();
    const option = this.findById(id);
    if (!option) return null;

    const votes = db.prepare('SELECT * FROM votes WHERE poll_option_id = ?').all(id);

    const voteSummaryRow = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN response = 'yes' THEN 1 ELSE 0 END) as yes,
          SUM(CASE WHEN response = 'maybe' THEN 1 ELSE 0 END) as maybe,
          SUM(CASE WHEN response = 'no' THEN 1 ELSE 0 END) as no
        FROM votes WHERE poll_option_id = ?
      `
      )
      .get(id);

    return {
      ...option,
      votes: votes.map((v) => ({
        id: v.id,
        pollOptionId: v.poll_option_id,
        participantId: v.participant_id,
        response: v.response,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      })),
      voteSummary: {
        yes: voteSummaryRow.yes ?? 0,
        maybe: voteSummaryRow.maybe ?? 0,
        no: voteSummaryRow.no ?? 0,
      },
    };
  }

  /**
   * Maps a raw database row to a PollOption object.
   * @param {any} row
   * @returns {import('./poll.entity.js').PollOption}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      pollId: row.poll_id,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      weekday: row.weekday,
      createdAt: row.created_at,
    };
  }
}
