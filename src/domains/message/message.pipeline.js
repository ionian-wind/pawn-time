import { InboxRepository } from './inbox.repository.js';
import { OutboxRepository } from './outbox.repository.js';

/**
 * Outbox pattern for Telegram messages.
 *
 * Inbound: every Telegram update is persisted to the inbox before handling (via
 * `recordUpdate`), so an update is never lost if the process dies mid-handling.
 * The pipeline re-dispatches any update still unprocessed after a restart.
 *
 * Outbound: every message the bot wants to send is written to the outbox first
 * (`enqueue`/`recordSend`); a background flush drains pending messages to the
 * real Telegram API, so a restart between enqueue and delivery cannot drop
 * messages.
 */
export class MessagePipeline {
  /**
   * Records an incoming Telegram update in the inbox. Returns the stored row,
   * or null when the update was already received (duplicate delivery), in which
   * case it is skipped.
   * @param {number} updateId
   * @param {object} update
   * @returns {import('./message.entity.js').IncomingMessage | null}
   */
  static recordUpdate(updateId, update) {
    return InboxRepository.record(updateId, update);
  }

  /**
   * Enqueues an outbound API call in the outbox for later dispatch.
   * @param {string} chatId
   * @param {string} method
   * @param {object} payload
   * @returns {import('./message.entity.js').OutgoingMessage}
   */
  static enqueue(chatId, method, payload) {
    return OutboxRepository.record(chatId, method, payload);
  }
}

export { InboxRepository, OutboxRepository };
