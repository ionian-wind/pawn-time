import { getDatabase } from '../../db/database.js';
import { PollRepository } from './poll.repository.js';
import { PollOptionRepository } from './poll-option.repository.js';
import { ParticipantRepository } from '../vote/participant.repository.js';
import { VoteRepository } from '../vote/vote.repository.js';

/**
 * Business logic for managing polls.
 */
export class PollService {
  /**
   * Creates a poll together with its options in a single transaction.
   * @param {import('./poll.entity.js').CreatePollInput} input
   * @param {Array<Omit<import('./poll.entity.js').CreatePollOptionInput, 'pollId'>>} options
   * @returns {import('./poll.entity.js').PollWithStats | null}
   */
  static createPoll(input, options) {
    const db = getDatabase();

    const createPollAndOptions = db.transaction(() => {
      const poll = PollRepository.create(input);
      const pollOptions = PollOptionRepository.createMany(
        options.map((opt) => ({ ...opt, pollId: poll.id }))
      );
      return { poll, pollOptions };
    });

    const result = createPollAndOptions();
    return PollRepository.getWithStats(result.poll.id);
  }

  /**
   * Finds a poll by id.
   * @param {string} id
   * @returns {import('./poll.entity.js').Poll | null}
   */
  static getPoll(id) {
    return PollRepository.findById(id);
  }

  /**
   * Finds a poll by id including options and stats.
   * @param {string} id
   * @returns {import('./poll.entity.js').PollWithStats | null}
   */
  static getPollWithStats(id) {
    return PollRepository.getWithStats(id);
  }

  /**
   * Lists polls.
   * @param {number} [limit]
   * @param {number} [offset]
   * @returns {Array<import('./poll.entity.js').Poll>}
   */
  static listPolls(limit = 100, offset = 0) {
    return PollRepository.findMany(limit, offset);
  }

  /**
   * Updates a poll.
   * @param {string} id
   * @param {Partial<import('./poll.entity.js').CreatePollInput>} data
   * @returns {import('./poll.entity.js').Poll | null}
   */
  static updatePoll(id, data) {
    return PollRepository.update(id, data);
  }

  /**
   * Deletes a poll.
   * @param {string} id
   * @returns {boolean}
   */
  static deletePoll(id) {
    return PollRepository.delete(id);
  }

  /**
   * Finalizes a poll, selecting the option with the best score
   * (each "yes" weighs 10, each "maybe" weighs 1).
   * @param {string} id
   * @returns {{ poll: import('./poll.entity.js').Poll | null, bestOption: import('./poll.entity.js').PollOptionWithVotes | null } | null}
   */
  static finalizePoll(id) {
    const poll = PollRepository.findById(id);
    if (!poll) return null;

    if (poll.isFinalized) {
      return { poll, bestOption: this.getFinalizedOption(poll) };
    }

    const options = PollOptionRepository.findByPollId(id);
    const bestOption = this.findBestOption(options.map((o) => o.id));

    if (bestOption) {
      const finalized = PollRepository.finalize(id, bestOption.id);
      return {
        poll: finalized,
        bestOption: PollOptionRepository.getWithVotes(bestOption.id),
      };
    }

    return { poll, bestOption: null };
  }

  /**
   * Returns a matrix of participant -> option -> response for a poll.
   * @param {string} pollId
   * @returns {Record<string, Record<string, string>> | null}
   */
  static getAvailabilityMatrix(pollId) {
    const poll = PollRepository.findById(pollId);
    if (!poll) return null;

    const options = PollOptionRepository.findByPollId(pollId);
    const participants = ParticipantRepository.findByPollId(pollId);

    /** @type {Record<string, Record<string, string>>} */
    const matrix = {};

    for (const participant of participants) {
      matrix[participant.id] = {};
      for (const option of options) {
        const vote = VoteRepository.findByPollOptionAndParticipant(option.id, participant.id);
        matrix[participant.id][option.id] = vote ? vote.response : 'no';
      }
    }

    return matrix;
  }

  /**
   * Returns the option with the highest score for a poll.
   * @param {string} pollId
   * @returns {import('./poll.entity.js').PollOptionWithVotes | null}
   */
  static getBestOption(pollId) {
    const poll = PollRepository.findById(pollId);
    if (!poll) return null;

    const options = PollOptionRepository.findByPollId(pollId);
    const bestOption = this.findBestOption(options.map((o) => o.id));

    return bestOption ? PollOptionRepository.getWithVotes(bestOption.id) : null;
  }

  /**
   * Returns the finalized option of a poll, if any.
   * @param {import('./poll.entity.js').Poll} poll
   * @returns {import('./poll.entity.js').PollOptionWithVotes | null}
   */
  static getFinalizedOption(poll) {
    if (!poll.finalizedSlotId) return null;
    return PollOptionRepository.getWithVotes(poll.finalizedSlotId);
  }

  /**
   * Finds the option id with the highest score.
   * @param {Array<string>} optionIds
   * @returns {{ id: string, score: number } | null}
   */
  static findBestOption(optionIds) {
    if (optionIds.length === 0) return null;

    /** @type {{ id: string, score: number } | null} */
    let best = null;

    for (const optionId of optionIds) {
      const withVotes = PollOptionRepository.getWithVotes(optionId);
      if (!withVotes) continue;

      const score = withVotes.voteSummary.yes * 10 + withVotes.voteSummary.maybe * 1;
      if (!best || score > best.score) {
        best = { id: optionId, score };
      }
    }

    return best;
  }
}
