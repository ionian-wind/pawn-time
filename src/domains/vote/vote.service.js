import { ParticipantRepository, VoteRepository } from './index.js';
import { PollRepository } from '../poll/poll.repository.js';
import { PollOptionRepository } from '../poll/poll-option.repository.js';
import { UserRepository } from '../user/user.repository.js';

/**
 * Business logic for casting and managing votes.
 */
export class VoteService {
  /**
   * Casts (or updates) a vote for a participant identified by session id.
   * Creates the participant on first vote if allowed.
   * @param {string} pollId
   * @param {string} sessionId
   * @param {string} optionId
   * @param {import('./vote.entity.js').VoteResponse} response
   * @param {{ name?: string, email?: string }} [participantInfo]
   * @returns {{ voteSaved: boolean, error?: string } | null}
   */
  static castVote(pollId, sessionId, optionId, response, participantInfo = {}) {
    const poll = PollRepository.findById(pollId);
    if (!poll) return null;

    if (!this.canVote(poll)) {
      return { voteSaved: false, error: 'Cannot vote on this poll' };
    }

    const option = PollOptionRepository.findById(optionId);
    if (!option || option.pollId !== pollId) {
      return { voteSaved: false, error: 'Invalid poll option' };
    }

    if (response === 'maybe' && !poll.allowMaybe) {
      return { voteSaved: false, error: 'Maybe responses are not allowed' };
    }

    const user = this.resolveUser(participantInfo, sessionId);
    const userId = user.id;

    if (poll.requireIdentification && !user.name) {
      return { voteSaved: false, error: 'Name is required to vote' };
    }

    let participant = ParticipantRepository.findByPollAndUser(pollId, userId);

    if (!participant) {
      const participantCount = ParticipantRepository.findByPollId(pollId).length;
      if (poll.maxParticipants !== null && participantCount >= poll.maxParticipants) {
        return { voteSaved: false, error: 'Maximum participants reached' };
      }

      participant = ParticipantRepository.create({
        pollId,
        userId,
      });
    }

    VoteRepository.upsert({
      pollOptionId: optionId,
      participantId: participant.id,
      response,
    });

    return { voteSaved: true };
  }

  /**
   * Resolves a user account for a session, creating one on demand if needed.
   * Every participant requires a user account, so this always returns a user.
   * @param {{ name?: string, email?: string }} info
   * @param {string} sessionId
   * @returns {import('../user/user.entity.js').User}
   */
  static resolveUser(info, sessionId) {
    return UserRepository.findOrCreateBySession({ name: info.name, email: info.email }, sessionId);
  }

  /**
   * Changes the response of an existing vote.
   * @param {string} pollId
   * @param {string} participantId
   * @param {string} optionId
   * @param {import('./vote.entity.js').VoteResponse} response
   * @returns {{ voteSaved: boolean, error?: string } | null}
   */
  static changeVote(pollId, participantId, optionId, response) {
    const poll = PollRepository.findById(pollId);
    if (!poll) return null;

    if (!this.canVote(poll)) {
      return { voteSaved: false, error: 'Cannot vote on this poll' };
    }

    if (response === 'maybe' && !poll.allowMaybe) {
      return { voteSaved: false, error: 'Maybe responses are not allowed' };
    }

    const vote = VoteRepository.findByPollOptionAndParticipant(optionId, participantId);
    if (!vote) return { voteSaved: false, error: 'No existing vote to change' };

    VoteRepository.updateResponse(vote.id, response);
    return { voteSaved: true };
  }

  /**
   * Returns a map of option id -> response for a participant's votes in a poll.
   * @param {string} pollId
   * @param {string} sessionId
   * @returns {Record<string, import('./vote.entity.js').VoteResponse> | null}
   */
  static getParticipantVotes(pollId, sessionId) {
    const participantId = this.getParticipantId(pollId, sessionId);
    if (!participantId) return {};

    const votes = VoteRepository.findByParticipant(participantId);
    /** @type {Record<string, import('./vote.entity.js').VoteResponse>} */
    const result = {};

    for (const vote of votes) {
      result[vote.pollOptionId] = vote.response;
    }

    return result;
  }

  /**
   * Returns the participant id for a session in a poll, if one exists.
   * @param {string} pollId
   * @param {string} sessionId
   * @returns {string | null}
   */
  static getParticipantId(pollId, sessionId) {
    const user = UserRepository.findBySessionId(sessionId);
    if (!user) return null;

    const participant = ParticipantRepository.findByPollAndUser(pollId, user.id);
    return participant ? participant.id : null;
  }

  /**
   * Determines whether a poll is still open for voting.
   * @param {import('../poll/poll.entity.js').Poll} poll
   * @returns {boolean}
   */
  static canVote(poll) {
    if (poll.isFinalized) return false;

    if (poll.expiresAt) {
      const now = new Date();
      const expires = new Date(poll.expiresAt);
      if (now > expires) return false;
    }

    return true;
  }
}
