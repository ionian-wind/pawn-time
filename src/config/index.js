import './dotenv.js';
import { join } from 'node:path';

/**
 * Reads an environment variable as a string.
 * @param {string} key
 * @param {string} [defaultValue]
 * @returns {string | undefined}
 */
const envString = (key, defaultValue) => process.env[key] ?? defaultValue;

/**
 * Reads an environment variable as an integer.
 * @param {string} key
 * @param {number} [defaultValue]
 * @returns {number | undefined}
 */
function envInt(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Resolves a path relative to the project root directory.
 * @param {string} p
 * @returns {string}
 */
function resolvePath(p) {
  return join(process.cwd(), p);
}

export const config = {
  /**
   * The SQLite database path. Use ":memory:" for an in-memory database.
   * @type {string}
   */
  get databasePath() {
    return resolvePath(envString('DATABASE_PATH', join('data', 'pawn-time.db')));
  },

  /**
   * The port the HTTP server will listen on.
   * @type {number}
   */
  get port() {
    return envInt('PORT', 3000);
  },

  /**
   * The application environment (development, test, production, ...).
   * @type {string}
   */
  get env() {
    return envString('NODE_ENV', 'development');
  },

  /**
   * The Telegram Bot API token used by the bot front-end.
   * @type {string | undefined}
   */
  get telegramBotToken() {
    return envString('TELEGRAM_BOT_TOKEN');
  },

  /**
   * Logging verbosity: debug | info | warn | error | silent.
   * @type {string}
   */
  get logLevel() {
    return envString('LOG_LEVEL', 'info');
  },

  /**
   * Maximum number of days an author may select in one draft.
   * @type {number}
   */
  get maxScheduleDays() {
    return envInt('MAX_SCHEDULE_DAYS', 4);
  },

  /**
   * Maximum number of 30-minute slots an author may select per day.
   * @type {number}
   */
  get maxSlotsPerDay() {
    return envInt('MAX_SLOTS_PER_DAY', 6);
  },
};
