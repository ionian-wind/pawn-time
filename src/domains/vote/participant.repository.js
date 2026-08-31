import { BaseRepository } from '../../db/base-repository.js';

/**
 * Repository for participants (a user's participation in a poll).
 */
export class ParticipantRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'participants';

  /** @type {boolean} */
  static HAS_UPDATED_AT = false;

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'pollId', column: 'poll_id' },
    { field: 'userId', column: 'user_id' },
  ];

  /**
   * Lists all participants of a poll.
   * @param {string} pollId
   * @returns {Array<import('./vote.entity.js').Participant>}
   */
  static findByPollId(pollId) {
    return this.findMany('poll_id = ?', [pollId]);
  }

  /**
   * Finds a participant in a poll by user id.
   * @param {string} pollId
   * @param {string} userId
   * @returns {import('./vote.entity.js').Participant | null}
   */
  static findByPollAndUser(pollId, userId) {
    return this.findOne('poll_id = ? AND user_id = ?', [pollId, userId]);
  }

  /**
   * Maps a raw database row to a Participant object.
   * @param {any} row
   * @returns {import('./vote.entity.js').Participant}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      pollId: row.poll_id,
      userId: row.user_id,
      createdAt: row.created_at,
    };
  }
}
