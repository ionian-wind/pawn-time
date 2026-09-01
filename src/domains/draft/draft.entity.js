/**
 * A single date/time slot selected for a draft, e.g. { date: "2026-09-01",
 * start: "10:00", end: "10:30" }.
 * @typedef {Object} DraftTimeSlot
 * @property {string} date - ISO date (YYYY-MM-DD)
 * @property {string} start - 24h start time (HH:MM)
 * @property {string} end - 24h end time (HH:MM), after `start`
 */

/**
 * A draft is a private, half-finished scheduling poll. It belongs to a single
 * author (via a user account) and is never shared with anyone else until it is
 * published as a real poll.
 * @typedef {Object} Draft
 * @property {string} id
 * @property {string | null} title
 * @property {string} authorUserId
 * @property {string | null} chatId - chat the published poll is destined for
 * @property {string} pollType
 * @property {Array<string>} selectedDates - ISO dates the author picked
 * @property {Array<DraftTimeSlot>} timeSlots - chosen 30-minute slots
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} CreateDraftInput
 * @property {string} authorUserId
 * @property {string} [title]
 * @property {string} [chatId]
 * @property {string} [pollType]
 */

export {};
