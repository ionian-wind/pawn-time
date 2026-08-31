/**
 * @typedef {'date' | 'weekday' | 'datetime'} PollType
 */

/**
 * @typedef {Object} Poll
 * @property {string} id
 * @property {string} title
 * @property {string | null} description
 * @property {string | null} location
 * @property {PollType} pollType
 * @property {string} timezone
 * @property {boolean} allowMaybe
 * @property {boolean} anonymousVoting
 * @property {boolean} requireIdentification
 * @property {number | null} maxParticipants
 * @property {string | null} expiresAt
 * @property {boolean} isFinalized
 * @property {string | null} finalizedAt
 * @property {string | null} finalizedSlotId
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} CreatePollInput
 * @property {string} title
 * @property {string} [description]
 * @property {string} [location]
 * @property {PollType} pollType
 * @property {string} [timezone]
 * @property {boolean} [allowMaybe]
 * @property {boolean} [anonymousVoting]
 * @property {boolean} [requireIdentification]
 * @property {number} [maxParticipants]
 * @property {string} [expiresAt]
 */

/**
 * @typedef {Object} PollOption
 * @property {string} id
 * @property {string} pollId
 * @property {string} date
 * @property {string | null} startTime
 * @property {string | null} endTime
 * @property {number | null} weekday
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CreatePollOptionInput
 * @property {string} pollId
 * @property {string} date
 * @property {string} [startTime]
 * @property {string} [endTime]
 * @property {number} [weekday]
 */

/**
 * @typedef {Object} VoteCounts
 * @property {number} yes
 * @property {number} maybe
 * @property {number} no
 */

/**
 * @typedef {Object} PollWithStats
 * @property {string} id
 * @property {string} title
 * @property {string | null} description
 * @property {string | null} location
 * @property {PollType} pollType
 * @property {string} timezone
 * @property {boolean} allowMaybe
 * @property {boolean} anonymousVoting
 * @property {boolean} requireIdentification
 * @property {number | null} maxParticipants
 * @property {string | null} expiresAt
 * @property {boolean} isFinalized
 * @property {string | null} finalizedAt
 * @property {string | null} finalizedSlotId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Array<PollOption>} options
 * @property {number} participantCount
 * @property {VoteCounts} voteCounts
 */

/**
 * @typedef {Object} PollOptionWithVotes
 * @property {string} id
 * @property {string} pollId
 * @property {string} date
 * @property {string | null} startTime
 * @property {string | null} endTime
 * @property {number | null} weekday
 * @property {string} createdAt
 * @property {Array<import('../../domains/vote/vote.entity.js').Vote>} votes
 * @property {VoteCounts} voteSummary
 */

export {};
