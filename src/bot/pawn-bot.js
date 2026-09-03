import { Bot } from 'node-telegram-bot-api';

import { InboxRepository, OutboxRepository } from '../domains/message/message.pipeline.js';
import { describeApiError, isRetryableApiError } from './api-error.js';

/**
 * Bot subclass adding the message-pipeline durability guarantees around the
 * base dispatcher:
 *   - `handleUpdate` persists every inbound update to the inbox before
 *     handling (deduping by `update_id`, since Telegram redelivers) and marks
 *     it processed afterwards, so a crash mid-handling never loses an event.
 *   - `flushOutbox` drains the outbox journal through the raw Telegram API
 *     client without re-recording the sends.
 *   - `replayInbox` re-dispatches inbound updates that were persisted but never
 *     finished handling (e.g. the process died mid-handling).
 */
export class PawnBot extends Bot {
  /**
   * Bound before the logging wrapper replaces `this.api.request`, so the
   * outbox can replay the journal without re-recording.
   */
  #rawApiRequest;

  /**
   * @param {string} token
   * @param {import('node-telegram-bot-api').BotOptions} [options]
   */
  constructor(token, options) {
    super(token, options);
    this.#rawApiRequest = this.api.request.bind(this.api);
  }

  /**
   * The unwrapped Telegram API request function captured at construction time.
   * @returns {(method: string, params?: object, signal?: AbortSignal) => Promise<*>}
   */
  get rawApiRequest() {
    return this.#rawApiRequest;
  }

  /**
   * The one dispatch path: persist the update, handle it via the base Bot, and
   * mark it processed (also dedupes redelivered `update_id`s).
   * @param {import('node-telegram-bot-api').Update} update
   * @returns {Promise<void>}
   */
  async handleUpdate(update) {
    if (!update || typeof update.update_id !== 'number') {
      await super.handleUpdate(update);
      return;
    }
    const recorded = InboxRepository.record(update.update_id, update);
    if (!recorded) return;
    try {
      await super.handleUpdate(update);
    } finally {
      InboxRepository.markProcessed(recorded.id);
    }
  }

  /**
   * Re-dispatches any inbound updates that were persisted but never finished
   * handling (e.g. the process died mid-handling).
   * @returns {Promise<number>} how many updates were replayed
   */
  async replayInbox() {
    const pending = InboxRepository.listUnprocessed();
    for (const message of pending) {
      try {
        await super.handleUpdate(message.payload);
      } finally {
        InboxRepository.markProcessed(message.id);
      }
    }
    return pending.length;
  }

  /**
   * Drains any outbound messages left in the outbox from a previous run (or
   * enqueued programmatically), dispatching them to the real Telegram API.
   * @param {number} [limit]
   * @returns {Promise<number>} how many pending rows were processed
   */
  async flushOutbox(limit = 100) {
    const pending = OutboxRepository.listPending(limit);
    for (const message of pending) {
      try {
        if (
          message.fingerprint != null &&
          OutboxRepository.findSentByFingerprint(message.fingerprint)
        ) {
          OutboxRepository.markSent(message.id);
          continue;
        }
        await this.#rawApiRequest(message.method, message.payload);
        OutboxRepository.markSent(message.id);
      } catch (err) {
        OutboxRepository.markFailed(message.id, describeApiError(err), {
          giveUp: !isRetryableApiError(err),
        });
      }
    }
    return pending.length;
  }
}
