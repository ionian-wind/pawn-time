import { config } from '../config/index.js';

/**
 * Minimal leveled logger. Emits one JSON line per record so the output is
 * greppable and machine-readable. The level is read from LOG_LEVEL at import
 * time.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** @type {number} */
let threshold = Object.prototype.hasOwnProperty.call(LEVELS, config.logLevel)
  ? LEVELS[config.logLevel]
  : LEVELS.info;

/**
 * Overrides the effective log level (useful in tests).
 * @param {keyof typeof LEVELS} level
 */
export function setLogLevel(level) {
  if (Object.prototype.hasOwnProperty.call(LEVELS, level)) threshold = LEVELS[level];
}

/**
 * Emits a log record when the record's level meets the threshold.
 * @param {keyof typeof LEVELS} level
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
function write(level, message, data) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...data,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

/** @type {Record<keyof typeof LEVELS, (msg: string, data?: Record<string, unknown>) => void>} */
export const logger = {
  debug(msg, data) {
    if (threshold <= LEVELS.debug) write('debug', msg, data);
  },
  info(msg, data) {
    if (threshold <= LEVELS.info) write('info', msg, data);
  },
  warn(msg, data) {
    if (threshold <= LEVELS.warn) write('warn', msg, data);
  },
  error(msg, data) {
    if (threshold <= LEVELS.error) write('error', msg, data);
  },
};
