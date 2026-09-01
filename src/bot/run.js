import { config } from '../config/index.js';
import { createBot } from './index.js';

/**
 * Starts the Telegram bot (long-polling). Requires TELEGRAM_BOT_TOKEN to be
 * set via env / .env.
 * @param {object} [options]
 * @returns {Promise<import('node-telegram-bot-api').Bot>}
 */
(async (options = {}) => {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set; cannot start the bot.');
  }
  const bot = createBot(token, options);
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
