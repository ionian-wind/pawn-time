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
 * @property {number | null} ephemeralMessageId - non-null when the form is an
 *   ephemeral message in a group chat; then considered along with
 *   `receiverUserId` and `chatId` (the group)
 * @property {number | null} receiverUserId - user the ephemeral form is for
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
 * @property {string | null} formChatId - chat hosting the draft form message
 * @property {number | null} formMessageId - the draft form message to remove on publish
 * @property {number | null} formEphemeralMessageId - ephemeral id of the form,
 *   when it is an ephemeral message in a group chat
 * @property {number | null} formReceiverUserId - user the ephemeral form was for
 */

export {};
