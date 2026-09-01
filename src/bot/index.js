import { Bot } from 'node-telegram-bot-api';
import { FlowManager } from './flow.js';
import { getTranslator } from './i18n.js';
import { logger } from './logger.js';

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

  withApiLogging(bot);

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

  bot.command('cancel', async (ctx) => {
    const from = ctx.from;
    if (from) {
      flow.clear(String(from.id), from.id);
      flow.clear(String(ctx.chatId), from.id);
      if (ctx.reply) await ctx.reply(getTranslator(from.language_code)('draftCancelled'));
    }
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
    const result = flow.onCallback(String(ctx.chatId), from.id, query.data);
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
    if (target) await sendMessage(bot, target, result.content);
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
 * Wraps `bot.api.request` so every Telegram API call and its outcome is logged.
 * The wrapper rethrows errors so normal error handling is unaffected.
 * @param {import('node-telegram-bot-api').Bot} bot
 */
function withApiLogging(bot) {
  const apiRequest = bot.api.request.bind(bot.api);
  bot.api.request = async (method, params, signal) => {
    const started = Date.now();
    try {
      const response = await apiRequest(method, params, signal);
      logger.info('telegram api', { method, ms: Date.now() - started });
      return response;
    } catch (err) {
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
