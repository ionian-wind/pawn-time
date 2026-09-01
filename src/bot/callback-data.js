export const ACTION = Object.freeze({
  DAY: 'day',
  SLOT: 'slot',
  OK: 'ok',
  RESET: 'reset',
  PREV_DAY: 'prev',
  NEXT_DAY: 'next',
  MONTH: 'month',
  BACK: 'back',
  VOTE: 'vote',
  VOTE_START: 'vstart',
  STAGE: 'stage',
  VOTE_CONFIRM: 'vok',
  VOTE_CANCEL: 'vcancel',
  EDIT_DRAFT: 'edit',
  DELETE_DRAFT: 'del',
  DELETE_ALL: 'delall',
  REMOVE: 'remove',
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
 *           { type: 'back' } |
 *           { type: 'vote', pollId: string, optionIndex: number, response: import('../domains/vote/vote.entity.js').VoteResponse } |
 *           { type: 'vstart', pollId: string } |
 *           { type: 'stage', pollId: string, optionIndex: number, response: import('../domains/vote/vote.entity.js').VoteResponse } |
 *           { type: 'vconfirm', pollId: string } |
 *           { type: 'vcancel', pollId: string } |
 *           { type: 'edit', draftId: string } |
 *           { type: 'del', draftId: string } |
 *           { type: 'delall' } |
 *           { type: 'remove' }} CallbackData
 */

const RESPONSE_ABBREV = Object.freeze({ y: 'yes', m: 'maybe', n: 'no' });

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

/**
 * @param {string} date @param {string} start
 * @param start
 */
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
 * Encodes a vote on one option of a poll. The option is referenced by its
 * 0-based index within the poll (not its uuid) and the response by a single
 * letter, keeping the payload well under Telegram's 64-byte limit.
 * @param {string} pollId
 * @param {number} optionIndex
 * @param {import('../domains/vote/vote.entity.js').VoteResponse} response
 * @returns {string}
 */
export function voteCallback(pollId, optionIndex, response) {
  return encode(ACTION.VOTE, `${pollId}:${optionIndex}:${response[0]}`);
}

/**
 * Encodes a press of the poll's global "Vote" button, which opens the voting
 * panel for the viewer. Votes are only applied after an explicit confirm.
 * @param {string} pollId
 * @returns {string}
 */
export function voteStartCallback(pollId) {
  return encode(ACTION.VOTE_START, pollId);
}

/**
 * Encodes a staged (not yet applied) response for one option: chooses `response`
 * for the option, or removes it when the same response is chosen again.
 * @param {string} pollId
 * @param {number} optionIndex
 * @param {import('../domains/vote/vote.entity.js').VoteResponse} response
 * @returns {string}
 */
export function stageCallback(pollId, optionIndex, response) {
  return encode(ACTION.STAGE, `${pollId}:${optionIndex}:${response[0]}`);
}

/**
 * Encodes the "Confirm" press that applies all staged votes at once.
 * @param {string} pollId
 * @returns {string}
 */
export function voteConfirmCallback(pollId) {
  return encode(ACTION.VOTE_CONFIRM, pollId);
}

/**
 * Encodes the "Cancel" press that discards all staged votes.
 * @param {string} pollId
 * @returns {string}
 */
export function voteCancelCallback(pollId) {
  return encode(ACTION.VOTE_CANCEL, pollId);
}

/**
 * Encodes a press of the "Continue" button for a draft in the /drafts list,
 * which resumes the draft-creation flow for that draft.
 * @param {string} draftId
 * @returns {string}
 */
export function editDraftCallback(draftId) {
  return encode(ACTION.EDIT_DRAFT, draftId);
}

/**
 * Encodes a press of the "Delete" button for a draft in the /drafts list.
 * @param {string} draftId
 * @returns {string}
 */
export function deleteDraftCallback(draftId) {
  return encode(ACTION.DELETE_DRAFT, draftId);
}

/**
 * Encodes a press of the "Delete all" button for the /drafts list, which
 * removes every draft of the current user at once.
 * @returns {string}
 */
export function deleteAllDraftsCallback() {
  return encode(ACTION.DELETE_ALL, '');
}

/**
 * Encodes a press of the "Remove" button on the draft-creation screens, which
 * deletes the draft and ends the flow session.
 * @returns {string}
 */
export function removeDraftCallback() {
  return encode(ACTION.REMOVE, '');
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
    case ACTION.VOTE: {
      const sepA = payload.indexOf(':');
      if (sepA === -1) return null;
      const pollId = payload.slice(0, sepA);
      const rest = payload.slice(sepA + 1);
      const sepB = rest.lastIndexOf(':');
      const optionIndex = Number(rest.slice(0, sepB === -1 ? rest.length : sepB));
      const response = RESPONSE_ABBREV[rest.slice(sepB === -1 ? 0 : sepB + 1)];
      if (!pollId || !response || Number.isNaN(optionIndex)) return null;
      return { type: 'vote', pollId, optionIndex, response };
    }
    case ACTION.VOTE_START:
      return payload ? { type: 'vstart', pollId: payload } : null;
    case ACTION.STAGE: {
      const sepA = payload.indexOf(':');
      if (sepA === -1) return null;
      const pollId = payload.slice(0, sepA);
      const rest = payload.slice(sepA + 1);
      const sepB = rest.indexOf(':');
      if (sepB === -1) return null;
      const optionIndex = Number(rest.slice(0, sepB));
      const response = RESPONSE_ABBREV[rest.slice(sepB + 1)];
      if (!pollId || !response || Number.isNaN(optionIndex)) return null;
      return { type: 'stage', pollId, optionIndex, response };
    }
    case ACTION.VOTE_CONFIRM:
      return payload ? { type: 'vconfirm', pollId: payload } : null;
    case ACTION.VOTE_CANCEL:
      return payload ? { type: 'vcancel', pollId: payload } : null;
    case ACTION.EDIT_DRAFT:
      return payload ? { type: 'edit', draftId: payload } : null;
    case ACTION.DELETE_DRAFT:
      return payload ? { type: 'del', draftId: payload } : null;
    case ACTION.DELETE_ALL:
      return { type: 'delall' };
    case ACTION.REMOVE:
      return { type: 'remove' };
    case ACTION.NOOP:
      return null;
    default:
      return null;
  }
}
