import { config } from '../config/index.js';
import { createBot } from './index.js';
import { registerBotCommands } from './commands.js';

/** Interval between flush attempts of the outbox (ms). */
const FLUSH_INTERVAL_MS = 15_000;

/**
 * Starts the Telegram bot (long-polling). Requires TELEGRAM_BOT_TOKEN to be
 * set via env / .env. The slash-command menu is registered on startup for the
 * default (English) scope and for Russian.
 *
 * Startup ordering matters for the outbox pattern: pending inbound updates are
 * replayed first (they were received before a previous shutdown but not fully
 * handled), then any outbound messages left in the outbox are flushed, and
 * finally polling starts. A periodic flush keeps the outbox drained for sends
 * enqueued outside the request path.
 * @param {object} [options]
 * @returns {Promise<import('node-telegram-bot-api').Bot>}
 */
(async (options = {}) => {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set; cannot start the bot.');
  }
  const bot = createBot(token, options);
  await registerBotCommands(bot);
  await registerBotCommands(bot, 'ru');
  await bot.replayInbox();
  await bot.flushOutbox();

  const flushTimer = setInterval(() => {
    bot.flushOutbox().catch((err) => console.error(err?.message));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();

  await bot.startPolling();
  return bot;
})()
  .then((bot) => {
    console.log('Pawn Time bot is polling...');
    const shutdown = () => {
      bot.stop();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
