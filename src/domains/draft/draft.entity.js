/**
 * A single availability interval selected for a draft, e.g. { date: "2026-09-01",
 * start: "10:00", end: "11:00" }. Adjacent 30-minute picks are stored merged,
 * so "10:00" and "10:30" selections become one interval "10:00–11:00".
 * @typedef {object} DraftTimeSlot
 * @property {string} date - ISO date (YYYY-MM-DD)
 * @property {string} start - 24h start time (HH:MM)
 * @property {string} end - 24h end time (HH:MM), after `start`
 */

/**
 * A draft is a private, half-finished scheduling poll. It belongs to a single
 * author (via a user account) and is never shared with anyone else until it is
 * published as a real poll.
 * @typedef {object} Draft
 * @property {string} id
 * @property {string | null} title
 * @property {string} authorUserId
 * @property {string | null} chatId - chat the published poll is destined for
 * @property {string} pollType
 * @property {Array<string>} selectedDates - ISO dates the author picked
 * @property {Array<DraftTimeSlot>} timeSlots - chosen availability intervals (merged)
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} CreateDraftInput
 * @property {string} authorUserId
 * @property {string} [title]
 * @property {string} [chatId]
 * @property {string} [pollType]
 */

export {};
