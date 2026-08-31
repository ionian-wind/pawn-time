import { BaseRepository } from '../../db/base-repository.js';
import { getDatabase } from '../../db/database.js';

/**
 * Repository for votes.
 */
export class VoteRepository extends BaseRepository {
  /** @type {string} */
  static TABLE = 'votes';

  /** @type {Array<import('../../db/base-repository.entity.js').ColumnConfig>} */
  static COLUMNS = [
    { field: 'pollOptionId', column: 'poll_option_id' },
    { field: 'participantId', column: 'participant_id' },
    { field: 'response', column: 'response' },
  ];

  /**
   * Finds a vote for a specific option and participant.
   * @param {string} pollOptionId
   * @param {string} participantId
   * @returns {import('./vote.entity.js').Vote | null}
   */
  static findByPollOptionAndParticipant(pollOptionId, participantId) {
    return this.findOne('poll_option_id = ? AND participant_id = ?', [pollOptionId, participantId]);
  }

  /**
   * Lists all votes for a participant.
   * @param {string} participantId
   * @returns {Array<import('./vote.entity.js').Vote>}
   */
  static findByParticipant(participantId) {
    return this.findMany('participant_id = ?', [participantId]);
  }

  /**
   * Lists all votes for a poll option.
   * @param {string} pollOptionId
   * @returns {Array<import('./vote.entity.js').Vote>}
   */
  static findByPollOption(pollOptionId) {
    return this.findMany('poll_option_id = ?', [pollOptionId]);
  }

  /**
   * Inserts a vote, or updates it if a vote already exists for the
   * same option/participant combination.
   * @param {import('./vote.entity.js').CreateVoteInput} input
   * @returns {import('./vote.entity.js').Vote}
   */
  static upsert(input) {
    const existing = this.findByPollOptionAndParticipant(input.pollOptionId, input.participantId);

    if (existing) {
      return this.updateResponse(existing.id, input.response);
    }

    return this.create(input);
  }

  /**
   * Updates the response of a vote.
   * @param {string} id
   * @param {import('./vote.entity.js').VoteResponse} response
   * @returns {import('./vote.entity.js').Vote | null}
   */
  static updateResponse(id, response) {
    const db = getDatabase();
    const existing = this.findById(id);
    if (!existing) return null;

    const now = this.now();
    db.prepare('UPDATE votes SET response = ?, updated_at = ? WHERE id = ?').run(response, now, id);
    return this.findById(id);
  }

  /**
   * Deletes all votes for a participant.
   * @param {string} participantId
   * @returns {boolean}
   */
  static deleteByParticipant(participantId) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM votes WHERE participant_id = ?').run(participantId);
    return result.changes > 0;
  }

  /**
   * Returns a map of option id -> vote counts for all options of a poll.
   * @param {string} pollId
   * @returns {Map<string, import('./vote.entity.js').VoteCounts>}
   */
  static getVoteSummary(pollId) {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT
          po.id as option_id,
          SUM(CASE WHEN v.response = 'yes' THEN 1 ELSE 0 END) as yes,
          SUM(CASE WHEN v.response = 'maybe' THEN 1 ELSE 0 END) as maybe,
          SUM(CASE WHEN v.response = 'no' THEN 1 ELSE 0 END) as no
        FROM poll_options po
        LEFT JOIN votes v ON po.id = v.poll_option_id
        WHERE po.poll_id = ?
        GROUP BY po.id
      `
      )
      .all(pollId);

    /** @type {Map<string, import('./vote.entity.js').VoteCounts>} */
    const summary = new Map();
    for (const row of rows) {
      summary.set(row.option_id, {
        yes: row.yes ?? 0,
        maybe: row.maybe ?? 0,
        no: row.no ?? 0,
      });
    }
    return summary;
  }

  /**
   * Maps a raw database row to a Vote object.
   * @param {any} row
   * @returns {import('./vote.entity.js').Vote}
   */
  static mapRowToEntity(row) {
    return {
      id: row.id,
      pollOptionId: row.poll_option_id,
      participantId: row.participant_id,
      response: row.response,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
