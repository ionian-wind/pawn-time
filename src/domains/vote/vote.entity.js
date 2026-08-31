/**
 * @typedef {'yes' | 'maybe' | 'no'} VoteResponse
 */

/**
 * @typedef {Object} Participant
 * @property {string} id
 * @property {string} pollId
 * @property {string} userId
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CreateParticipantInput
 * @property {string} pollId
 * @property {string} userId
 */

/**
 * @typedef {Object} Vote
 * @property {string} id
 * @property {string} pollOptionId
 * @property {string} participantId
 * @property {VoteResponse} response
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} CreateVoteInput
 * @property {string} pollOptionId
 * @property {string} participantId
 * @property {VoteResponse} response
 */

/**
 * @typedef {Object} VoteCounts
 * @property {number} yes
 * @property {number} maybe
 * @property {number} no
 */

export {};
