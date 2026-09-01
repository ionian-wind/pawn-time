import { Bot } from 'node-telegram-bot-api';
import { FlowManager } from './flow.js';
import { getTranslator, normalizeLocale } from './i18n.js';
import { logger } from './logger.js';
import { decodeCallback } from './callback-data.js';
import { buildPollView } from './poll-view.js';
import { buildPollMessage, buildDraftsMessage } from './ui.js';
import { PollService } from '../domains/poll/poll.service.js';
import { VoteService } from '../domains/vote/vote.service.js';
import { DraftService } from '../domains/draft/draft.service.js';
import { UserRepository } from '../domains/user/user.repository.js';
import { InboxRepository, OutboxRepository } from '../domains/message/message.pipeline.js';

/**
 * Tracks the chat + message id of every published poll so that votes can be
 * applied by editing the poll message in place.
 * @type {Map<string, { chatId: string, messageId: number }>}
 */
const pollMessages = new Map();

/**
 * Per-viewer staged votes for each poll: key is `${sessionId}:${pollId}`, value
 * maps poll option id -> response. Nothing here is applied to the database
 * until the viewer presses Confirm.
 * @type {Map<string, Map<string, import('../domains/vote/vote.entity.js').VoteResponse>>}
 */
const pendingVotes = new Map();

/**
 * Wires a Telegram `Bot` to the `/new` draft flow.
 *
 * Flow model:
 *   - `/new` in a private chat starts the interactive draft builder there and
 *     publishes the finished poll to the same chat.
 *   - `/new` in a group starts the interactive builder in the author's DM with
 *     the bot (drafts stay private) and publishes the finished poll back to the
 *     group.
 *
 * The message body uses rich HTML text while the interactive controls are
 * classic inline buttons (hybrid approach).
 *
 * Logging: every incoming update is logged via a `use` middleware, and every
 * Telegram API call/response is logged by wrapping `bot.api.request`.
 * @param {string} token
 * @param {object} [options]
 * @returns {import('node-telegram-bot-api').Bot}
 */
export function createBot(token, options = {}) {
  const bot = new Bot(token, options);
  const flow = new FlowManager();

  // The unfiltered Telegram API client. Outbound sends go through the outbox
  // journal (so nothing is lost across a restart); `flushOutbox` uses this raw
  // request to drain the journal without re-recording.
  const rawApiRequest = bot.api.request.bind(bot.api);

  withApiLogging(bot, rawApiRequest);

  // The inbox wrapper: persist every update before handling so a crash mid-
  // handling never loses an event, and dedupe by update_id (Telegram redelivery).
  const rawHandleUpdate = bot.handleUpdate.bind(bot);
  bot.handleUpdate = async (update) => {
    if (!update || typeof update.update_id !== 'number') {
      await rawHandleUpdate(update);
      return;
    }
    const recorded = InboxRepository.record(update.update_id, update);
    if (!recorded) return;
    try {
      await rawHandleUpdate(update);
    } finally {
      InboxRepository.markProcessed(recorded.id);
    }
  };

  /**
   * Re-dispatches any inbound updates that were persisted but never finished
   * handling (e.g. the process died mid-handling). Returns how many were
   * replayed.
   * @returns {Promise<number>}
   */
  bot.replayInbox = async () => {
    const pending = InboxRepository.listUnprocessed();
    for (const message of pending) {
      try {
        await rawHandleUpdate(message.payload);
      } finally {
        InboxRepository.markProcessed(message.id);
      }
    }
    return pending.length;
  };

  /**
   * Drains any outbound messages left in the outbox from a previous run (or
   * enqueued programmatically), dispatching them to the real Telegram API.
   * Returns how many pending rows were processed.
   * @param {number} [limit]
   * @returns {Promise<number>}
   */
  bot.flushOutbox = async (limit = 100) => {
    const pending = OutboxRepository.listPending(limit);
    for (const message of pending) {
      try {
        await rawApiRequest(message.method, message.payload);
        OutboxRepository.markSent(message.id);
      } catch (err) {
        OutboxRepository.markFailed(message.id, describeApiError(err), {
          giveUp: !isRetryableApiError(err),
        });
      }
    }
    return pending.length;
  };

  bot.use(async (ctx, next) => {
    logIncoming(ctx);
    await next();
  });

  bot.command(['new', 'start'], async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const title = (ctx.match ?? '').trim();
    if (!title) {
      if (ctx.reply) await ctx.reply(getTranslator(from.language_code)('usage'));
      return;
    }
    const dmChatId = String(from.id);
    const publishChatId = isPrivate(ctx.chat) ? null : String(ctx.chat?.id ?? ctx.chatId);
    const start = flow.start(dmChatId, publishChatId, from, title);
    const sent = await sendMessage(bot, dmChatId, start.content);
    flow.setMessageId(start.sessionKey, sent.message_id);
  });

  bot.command('drafts', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const user = UserRepository.findOrCreateBySession(
      { name: from.first_name || undefined },
      String(from.id)
    );
    const drafts = DraftService.listDrafts(user.id);
    const content = buildDraftsMessage(drafts, normalizeLocale(from.language_code));
    await sendMessage(bot, String(from.id), content);
  });

  bot.on('callback_query', async (ctx) => {
    const from = ctx.from;
    const query = ctx.callbackQuery;
    if (!from || !query) return;
    if (ctx.answerCallbackQuery) {
      try {
        await ctx.answerCallbackQuery();
      } catch {
        // ignore answer failures; the update is still processed
      }
    }

    const decoded = decodeCallback(query.data);
    if (decoded && (await handlePollCallback(bot, decoded, String(from.id), from.language_code)))
      return;
    if (decoded && (await handleDraftsCallback(bot, flow, ctx, decoded))) return;

    const result = flow.onCallback(String(ctx.chatId), from.id, query.data);
    if (result?.type === 'removed') {
      const message = ctx.callbackQuery?.message;
      if (message?.message_id) {
        const chatId = String(message.chat?.id ?? ctx.chatId);
        await editMessage(bot, chatId, message.message_id, result.content);
      }
      return;
    }
    if (result) await present(bot, flow, result);
  });

  return bot;
}

/**
 * Renders a flow result: edits the interactive message in place, or sends new
 * messages when publishing.
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {FlowManager} flow
 * @param {import('./flow.entity.js').FlowResult} result
 */
async function present(bot, flow, result) {
  const sess = flow.getMessage(result.sessionKey);

  if (result.published) {
    const target = result.publishChatId ?? sess?.chatId;
    if (target) {
      const sent = await sendMessage(bot, target, result.content);
      if (result.poll?.id && sent?.message_id) {
        pollMessages.set(result.poll.id, { chatId: String(target), messageId: sent.message_id });
      }
    }
    return;
  }

  if (sess?.messageId) {
    await editMessage(bot, sess.chatId, sess.messageId, result.content);
  } else if (sess) {
    const sent = await sendMessage(bot, sess.chatId, result.content);
    flow.setMessageId(result.sessionKey, sent.message_id);
  }
}

/**
 * Routes a decoded callback that belongs to the poll voting panel. Returns true
 * when the callback was handled (and should not reach the /new flow).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {import('./callback-data.js').CallbackData} decoded
 * @param {string} sessionId - the voter's telegram user id
 * @param {string} [languageCode]
 * @returns {Promise<boolean>}
 */
async function handlePollCallback(bot, decoded, sessionId, languageCode) {
  switch (decoded.type) {
    case 'stage':
      await stageVote(
        bot,
        decoded.pollId,
        decoded.optionIndex,
        decoded.response,
        sessionId,
        languageCode
      );
      return true;
    case 'vconfirm':
      await confirmVotes(bot, decoded.pollId, sessionId, languageCode);
      return true;
    case 'vcancel':
      await cancelStaging(bot, decoded.pollId, sessionId, languageCode);
      return true;
    default:
      return false;
  }
}

/**
 * Handles the "Continue" / "Delete" buttons of the /drafts list. Returns true
 * when the callback was handled (and should not reach the draft flow).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {FlowManager} flow
 * @param {import('node-telegram-bot-api').Context} ctx
 * @param {import('./callback-data.js').CallbackData} decoded
 * @returns {Promise<boolean>}
 */
async function handleDraftsCallback(bot, flow, ctx, decoded) {
  if (decoded.type !== 'edit' && decoded.type !== 'del') return false;

  const from = ctx.from;
  if (!from) return true;
  const user = UserRepository.findOrCreateBySession(
    { name: from.first_name || undefined },
    String(from.id)
  );
  const message = ctx.callbackQuery?.message;
  const chatId = String(message?.chat?.id ?? from.id);

  if (decoded.type === 'edit') {
    const draft = DraftService.getDraft(decoded.draftId, user.id);
    if (!draft) {
      // already deleted elsewhere: refresh the list in place
      const content = buildDraftsMessage(
        DraftService.listDrafts(user.id),
        normalizeLocale(from.language_code)
      );
      if (message?.message_id) await editMessage(bot, chatId, message.message_id, content);
      return true;
    }
    flow.clear(chatId, from.id);
    const resumed = flow.resume(chatId, null, from, draft);
    if (!resumed) return true;
    if (message?.message_id) flow.setMessageId(resumed.sessionKey, message.message_id);
    await present(bot, flow, resumed);
    return true;
  }

  DraftService.deleteDraft(decoded.draftId, user.id);
  const content = buildDraftsMessage(
    DraftService.listDrafts(user.id),
    normalizeLocale(from.language_code)
  );
  if (message?.message_id) await editMessage(bot, chatId, message.message_id, content);
  return true;
}

/**
 * Stages (or unstages) a response for one grouped row of consecutive slots
 * without applying it. Choosing the same response again removes it from the
 * staged set (for every slot of the row).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} pollId
 * @param {number} rowIndex - index into the grouped poll view rows
 * @param {import('../domains/vote/vote.entity.js').VoteResponse} response
 * @param {string} sessionId
 * @param {string} [languageCode]
 * @returns {Promise<void>}
 */
async function stageVote(bot, pollId, rowIndex, response, sessionId, languageCode) {
  const poll = PollService.getPollWithStats(pollId);
  if (!poll || !VoteService.canVote(poll)) return;
  const row = buildPollView(poll, sessionId).rows[rowIndex];
  if (!row) return;

  const key = stagedKey(sessionId, pollId);
  const staged = pendingVotes.get(key) ?? new Map();
  for (const optionId of row.ids) {
    if (staged.get(optionId) === response) staged.delete(optionId);
    else staged.set(optionId, response);
  }
  pendingVotes.set(key, staged);
  await renderPoll(bot, pollId, sessionId, languageCode, staged);
}

/**
 * Applies every staged vote for the viewer at once and renders the poll back in
 * normal mode. This is the only place votes are written to the database.
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} pollId
 * @param {string} sessionId
 * @param {string} [languageCode]
 * @returns {Promise<void>}
 */
async function confirmVotes(bot, pollId, sessionId, languageCode) {
  const poll = PollService.getPollWithStats(pollId);
  if (!poll) return;
  const key = stagedKey(sessionId, pollId);
  const staged = pendingVotes.get(key);
  pendingVotes.delete(key);

  if (staged && VoteService.canVote(poll)) {
    for (const [optionId, response] of staged) {
      VoteService.castVote(pollId, sessionId, optionId, response);
    }
  }

  await renderPoll(bot, pollId, sessionId, languageCode, null);
}

/**
 * Discards the viewer's staged votes without applying them and renders the poll
 * back in normal mode.
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} pollId
 * @param {string} sessionId
 * @param {string} [languageCode]
 * @returns {Promise<void>}
 */
async function cancelStaging(bot, pollId, sessionId, languageCode) {
  pendingVotes.delete(stagedKey(sessionId, pollId));
  await renderPoll(bot, pollId, sessionId, languageCode, null);
}

/**
 * Re-renders a published poll message in place, from the viewer's perspective.
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} pollId
 * @param {string} sessionId
 * @param {string | undefined} languageCode
 * @param {Map<string, import('../domains/vote/vote.entity.js').VoteResponse> | null} staged
 * @returns {Promise<void>}
 */
async function renderPoll(bot, pollId, sessionId, languageCode, staged) {
  const poll = PollService.getPollWithStats(pollId);
  const msg = pollMessages.get(pollId);
  if (!poll || !msg) return;
  const content = buildPollMessage(
    buildPollView(poll, sessionId),
    normalizeLocale(languageCode),
    staged
  );
  await editMessage(bot, msg.chatId, msg.messageId, content);
}

/**
 * @param {string} sessionId @param {string} pollId
 * @param pollId
 */
function stagedKey(sessionId, pollId) {
  return `${sessionId}:${pollId}`;
}

/**
 * Sends a message: either classic HTML text with an inline keyboard, or a rich
 * message payload (when `content.rich_message` is present).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} chatId
 * @param {{ text?: string, reply_markup?: object, rich_message?: object }} content
 * @returns {Promise<{ message_id: number }>}
 */
async function sendMessage(bot, chatId, content) {
  const chatIdNum = Number(chatId);
  if (content.rich_message) {
    return bot.api.sendRichMessage({ chat_id: chatIdNum, rich_message: content.rich_message });
  }
  return bot.api.sendMessage({
    chat_id: chatIdNum,
    text: content.text,
    parse_mode: 'HTML',
    reply_markup: content.reply_markup,
  });
}

/**
 * Edits a message's body in place: either classic HTML text with an inline
 * keyboard, or a rich message payload (when `content.rich_message` is present).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} chatId
 * @param {number} messageId
 * @param {{ text?: string, reply_markup?: object, rich_message?: object }} content
 * @returns {Promise<void>}
 */
async function editMessage(bot, chatId, messageId, content) {
  const chatIdNum = Number(chatId);
  if (content.rich_message) {
    await bot.api.editMessageText({
      chat_id: chatIdNum,
      message_id: messageId,
      rich_message: content.rich_message,
    });
    return;
  }
  await bot.api.editMessageText({
    chat_id: chatIdNum,
    message_id: messageId,
    text: content.text,
    parse_mode: 'HTML',
    reply_markup: content.reply_markup,
  });
}

/**
 * @param {import('node-telegram-bot-api').Chat | undefined} chat
 * @returns {boolean}
 */
function isPrivate(chat) {
  return chat?.type === 'private';
}

/**
 * Outbound methods that are part of Telegram's control plane rather than
 * user-visible messages: they are not recorded in the outbox.
 * @type {Set<string>}
 */
const OUTBOX_EXCLUDED_METHODS = new Set([
  'getUpdates',
  'getMe',
  'deleteWebhook',
  'setWebhook',
  'setMyCommands',
  'deleteMyCommands',
  'getMyCommands',
  'answerCallbackQuery',
  'close',
  'logout',
]);

/**
 * Wraps `bot.api.request` so every Telegram API call is logged and (for
 * user-visible sends) journaled to the outbox before dispatch. The wrapper
 * rethrows errors so normal error handling is unaffected; a successful send is
 * marked `sent`, a failed one `failed` (or left pending for retry).
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {(method: string, params?: object, signal?: AbortSignal) => Promise<*>} rawRequest
 */
function withApiLogging(bot, rawRequest) {
  bot.api.request = async (method, params, signal) => {
    const journal = journalOutbound(method, params);
    const started = Date.now();
    try {
      const response = await rawRequest(method, params, signal);
      if (journal) OutboxRepository.markSent(journal.id);
      logger.info('telegram api', { method, ms: Date.now() - started });
      return response;
    } catch (err) {
      if (journal) {
        OutboxRepository.markFailed(journal.id, describeApiError(err), {
          giveUp: !isRetryableApiError(err),
        });
      }
      logger.error('telegram api error', {
        method,
        ms: Date.now() - started,
        code: err?.code,
        errorCode: err?.errorCode,
        description: err?.description,
        message: err?.message,
      });
      throw err;
    }
  };
}

/**
 * Records an outbound API call in the outbox when it is a user-visible message
 * (a send or edit carrying a chat_id). Control-plane calls and anything without
 * a chat are passed through.
 * @param {string} method
 * @param {object | undefined} params
 * @returns {import('../domains/message/message.entity.js').OutgoingMessage | null}
 */
function journalOutbound(method, params) {
  if (OUTBOX_EXCLUDED_METHODS.has(method)) return null;
  const chatId = params?.chat_id;
  if (chatId == null) return null;
  return OutboxRepository.record(String(chatId), method, params);
}

/**
 * Human-readable error text for a recorded API failure.
 * @param {*} err
 * @returns {string}
 */
function describeApiError(err) {
  if (err?.description) return `${err.description} (${err?.errorCode ?? 'no code'})`;
  return err?.message ?? String(err);
}

/**
 * A request is retryable when it failed before reaching Telegram (no HTTP
 * status) or with a server-side status (5xx); permanent 4xx rejection is a
 * definite failure.
 * @param {*} err
 * @returns {boolean}
 */
function isRetryableApiError(err) {
  const code = err?.errorCode ?? err?.response?.status;
  if (code == null) return true;
  return code >= 500;
}

/**
 * Logs an incoming update once, with as much useful context as the payload
 * carries (chat, sender, text, callback data).
 * @param {import('node-telegram-bot-api').Context} ctx
 */
function logIncoming(ctx) {
  const update = ctx.update;

  if (update.message) {
    const m = update.message;
    logger.info('incoming message', {
      chatId: m.chat?.id,
      chatType: m.chat?.type,
      fromId: m.from?.id,
      fromName: nameOf(m.from),
      text: m.text,
      messageId: m.message_id,
    });
    return;
  }

  if (update.edited_message) {
    const m = update.edited_message;
    logger.info('incoming edited_message', {
      chatId: m.chat?.id,
      chatType: m.chat?.type,
      fromId: m.from?.id,
      fromName: nameOf(m.from),
      text: m.text,
      messageId: m.message_id,
    });
    return;
  }

  if (update.channel_post) {
    const m = update.channel_post;
    logger.info('incoming channel_post', {
      chatId: m.chat?.id,
      chatType: m.chat?.type,
      fromId: m.from?.id,
      fromName: nameOf(m.from),
      text: m.text,
      messageId: m.message_id,
    });
    return;
  }

  if (update.callback_query) {
    const c = update.callback_query;
    logger.info('incoming callback_query', {
      fromId: c.from?.id,
      fromName: nameOf(c.from),
      data: c.data,
      queryId: c.id,
    });
    return;
  }

  const kind = Object.keys(update).find((k) => k !== 'update_id') ?? 'unknown';
  logger.debug('incoming update', { type: kind, updateId: update.update_id });
}

/**
 * Builds a compact "first_name last_name" label for a user, when available.
 * @param {{ first_name?: string, last_name?: string, username?: string } | undefined} user
 * @returns {string | undefined}
 */
function nameOf(user) {
  if (!user) return undefined;
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || undefined;
}
