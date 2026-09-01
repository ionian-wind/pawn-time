import pino from 'pino';

import { config } from '../config/index.js';

/**
 * Leveled logger backed by Pino. Emits one JSON line per record to the console
 * (stdout), which is Pino's default output. The level is read from LOG_LEVEL
 * at import time.
 */

/** @type {Set<string>} */
const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent']);

const root = pino(
  {
    level: LEVELS.has(config.logLevel) ? config.logLevel : 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  process.stdout
);

/**
 * Overrides the effective log level (useful in tests).
 * @param {string} level
 */
export function setLogLevel(level) {
  if (LEVELS.has(level)) root.level = level;
}

/** @type {Record<string, (msg: string, data?: Record<string, unknown>) => void>} */
export const logger = {
  debug(msg, data) {
    root.debug(data ?? {}, msg);
  },
  info(msg, data) {
    root.info(data ?? {}, msg);
  },
  warn(msg, data) {
    root.warn(data ?? {}, msg);
  },
  error(msg, data) {
    root.error(data ?? {}, msg);
  },
};
