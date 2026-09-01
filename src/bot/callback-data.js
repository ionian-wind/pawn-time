export const ACTION = Object.freeze({
  DAY: 'day',
  SLOT: 'slot',
  OK: 'ok',
  RESET: 'reset',
  PREV_DAY: 'prev',
  NEXT_DAY: 'next',
  MONTH: 'month',
  BACK: 'back',
  NOOP: 'noop',
});

export const STEP = Object.freeze({
  DAYS: 'days',
  TIMES: 'times',
});

/**
 * @typedef {{ type: 'day', date: string } |
 *           { type: 'slot', date: string, start: string } |
 *           { type: 'ok', step: string } |
 *           { type: 'reset', step: string } |
 *           { type: 'nav', dir: 'prev' | 'next' } |
 *           { type: 'month', dir: 1 | -1 } |
 *           { type: 'back' }} CallbackData
 */

/**
 * Encodes a callback_data string for a given payload. Stays well under
 * Telegram's 64-byte callback_data limit.
 * @param {string} kind
 * @param {string} payload
 * @returns {string}
 */
function encode(kind, payload) {
  return `${kind}:${payload}`;
}

/** @param {string} date */
export function dayCallback(date) {
  return encode(ACTION.DAY, date);
}

/** @param {string} date @param {string} start */
export function slotCallback(date, start) {
  return encode(ACTION.SLOT, `${date}:${start}`);
}

/** @param {string} step */
export function okCallback(step) {
  return encode(ACTION.OK, step);
}

/** @param {string} step */
export function resetCallback(step) {
  return encode(ACTION.RESET, step);
}

/** @param {'prev' | 'next'} dir */
export function navCallback(dir) {
  return encode(ACTION.PREV_DAY === dir ? ACTION.PREV_DAY : ACTION.NEXT_DAY, '');
}

/** @param {1 | -1} dir */
export function monthCallback(dir) {
  return encode(ACTION.MONTH, dir > 0 ? '+1' : '-1');
}

/** Returns to the previous step (e.g. time selection -> day selection). */
export function backCallback() {
  return encode(ACTION.BACK, '');
}

/** A callback that intentionally does nothing (e.g. disabled buttons). */
export function noopCallback() {
  return encode(ACTION.NOOP, '');
}

/**
 * Decodes a callback_data string into a structured payload, or null if it is
 * not one of our own.
 * @param {string | undefined} data
 * @returns {CallbackData | null}
 */
export function decodeCallback(data) {
  if (!data) return null;
  const [kind, ...rest] = data.split(':');
  const payload = rest.join(':');

  switch (kind) {
    case ACTION.DAY:
      return payload ? { type: 'day', date: payload } : null;
    case ACTION.SLOT: {
      const sep = payload.indexOf(':');
      const date = sep === -1 ? '' : payload.slice(0, sep);
      const start = sep === -1 ? '' : payload.slice(sep + 1);
      return date && start ? { type: 'slot', date, start } : null;
    }
    case ACTION.OK:
      return payload ? { type: 'ok', step: payload } : null;
    case ACTION.RESET:
      return payload ? { type: 'reset', step: payload } : null;
    case ACTION.PREV_DAY:
      return { type: 'nav', dir: 'prev' };
    case ACTION.NEXT_DAY:
      return { type: 'nav', dir: 'next' };
    case ACTION.MONTH:
      return payload === '-1' ? { type: 'month', dir: -1 } : { type: 'month', dir: 1 };
    case ACTION.BACK:
      return { type: 'back' };
    case ACTION.NOOP:
      return null;
    default:
      return null;
  }
}
