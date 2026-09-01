/**
 * Transient navigation state for one active draft-creation session. The durable
 * draft data lives in the `drafts` table; this holds only what is needed to
 * render the current step.
 * @typedef {object} FlowSession
 * @property {string} chatId
 * @property {number} fromId
 * @property {string} draftId
 * @property {string} authorId
 * @property {'days' | 'times'} step
 * @property {number} dayIndex - current day cursor within selectedDates
 * @property {number | null} messageId - the message being interactively edited
 * @property {string} locale - UI language for this session ("en" | "ru")
 * @property {{ year: number, monthIndex: number }} calendar - visible month
 */

/**
 * Result of a flow step. `content` is always present; `published` indicates the
 * draft was published to a real poll. `type` is set to `'removed'` when the
 * draft was deleted from the current screen.
 * @typedef {object} FlowResult
 * @property {'render' | 'removed'} [type]
 * @property {object} content - { text, reply_markup } to render
 * @property {boolean} published
 * @property {import('../domains/poll/poll.entity.js').PollWithStats | null} poll
 * @property {string} sessionKey
 * @property {string | null} publishChatId - chat to send the finished poll to
 */

export {};
