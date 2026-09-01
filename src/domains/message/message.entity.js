/**
 * @typedef {'pending' | 'sent' | 'failed'} OutgoingMessageStatus
 */

/**
 * A Telegram update (event) received from the bot API, persisted in the inbox
 * so handling survives a restart. `processedAt` is null while it is still
 * awaiting dispatch.
 * @typedef {object} IncomingMessage
 * @property {string} id
 * @property {number} updateId
 * @property {object} payload - the raw Telegram update object
 * @property {string} receivedAt
 * @property {string | null} processedAt
 */

/**
 * An outbound Telegram API request queued in the outbox. Pending messages are
 * drained to the real API by the dispatcher. `queuedAt` records when the
 * request was enqueued; `handledAt` records when the dispatcher was done with
 * it (sent, or permanently failed after exhausting retries); it stays null
 * while pending or awaiting retry. `statusChangedAt` is bumped whenever the
 * row's state changes. Handling duration is `handledAt - queuedAt`.
 * @typedef {object} OutgoingMessage
 * @property {string} id
 * @property {string} chatId
 * @property {string} method - the Telegram API method, e.g. "sendMessage"
 * @property {object} payload - the API call parameters
 * @property {OutgoingMessageStatus} status
 * @property {number} attempts
 * @property {string | null} error
 * @property {string} queuedAt
 * @property {string | null} sentAt
 * @property {string | null} handledAt
 * @property {string} statusChangedAt
 */

export {};
