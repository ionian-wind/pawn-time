import { config } from '../config/index.js';
import { createBot } from './index.js';
import { registerBotCommands } from './commands.js';
import { closeDatabase, verifyDatabase } from '../db/database.js';
import { registerShutdown } from '../util/shutdown.js';
import { logger } from './logger.js';

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
 *
 * `startPolling` is the long-poll pump and only resolves once the bot stops,
 * so it is not awaited: polling runs in the background while the process
 * handles signals. `registerShutdown` owns every exit path - SIGINT/SIGTERM
 * stop cleanly, while `unhandledRejection` / `uncaughtException` are logged
 * and then stopped through the same cleanup (exit 1). The startup-failure and
 * fatal-poll-error branches close the database directly too.
 * @param {object} [options]
 */
(async (options = {}) => {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set; cannot start the bot.');
  }

  try {
    verifyDatabase();
  } catch (err) {
    logger.warn('database verification failed at startup (native sqlite may crash next)', {
      message: err?.message,
    });
    throw err;
  }

  const bot = createBot(token, options);

  registerShutdown(
    () => {
      bot.stop();
      closeDatabase();
    },
    (kind, err) => {
      logger.error(kind, { message: err.message, stack: err.stack });
    }
  );

  await registerBotCommands(bot);
  await registerBotCommands(bot, 'ru');
  await bot.replayInbox();
  await bot.flushOutbox();

  const flushTimer = setInterval(() => {
    bot
      .flushOutbox()
      .catch((err) => logger.error('outbox flush failed', { message: err?.message }));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();

  bot.startPolling().catch((err) => {
    logger.error('polling stopped with an error', { message: err?.message });
    closeDatabase();
    process.exit(1);
  });

  logger.info('Pawn Time bot is polling...');
})().catch((err) => {
  logger.error('bot startup failed', { message: err.message });
  closeDatabase();
  process.exit(1);
});
