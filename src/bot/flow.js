import { UserRepository } from '../domains/user/user.repository.js';
import { DraftService } from '../domains/draft/draft.service.js';
import { decodeCallback, STEP } from './callback-data.js';
import { generateTimeSlots } from './slots.js';
import { currentCalendar, shiftMonth } from './calendar.js';
import { normalizeLocale, getTranslator } from './i18n.js';
import { buildDaysMessage, buildTimesMessage, buildPollMessage } from './ui.js';
import { buildPollView } from './poll-view.js';

const TIME_SLOTS = generateTimeSlots();

/**
 * Drives the `/new` draft-creation flow for a single author.
 *
 * Each active draft has an in-memory session holding transient navigation state
 * (current step, which day's time grid is shown). The durable data itself (title,
 * selected days, selected slots) lives in the drafts table and is only visible
 * to the author until the draft is published.
 */
export class FlowManager {
  constructor() {
    /** @type {Map<string, import('./flow.entity.js').FlowSession>} */
    this.sessions = new Map();
  }

  /**
   * Begins a new draft for a Telegram user, directly at the day-selection step.
   * The interactive flow runs in the bot's DM with the user (`dmChatId`); the
   * finished poll is published to `publishChatId` (falling back to the DM when
   * null). `title` is required by the `/new <title>` command.
   *
   * When `opts.receiverUserId` is set the form is an ephemeral message in a
   * group chat (the `dmChatId`), visible only to that user; the finished poll
   * is still published publicly.
   * @param {string} dmChatId
   * @param {string | null} publishChatId
   * @param {import('node-telegram-bot-api').User} from
   * @param {string} title
   * @param {{ receiverUserId?: number }} [opts]
   * @returns {{sessionKey: string, authorId: string, draftId: string, content: object}}
   */
  start(dmChatId, publishChatId, from, title, opts = {}) {
    const user = UserRepository.findOrCreateBySession(
      { name: from.first_name || undefined },
      String(from.id)
    );
    const draft = DraftService.createDraft({
      authorUserId: user.id,
      chatId: publishChatId ?? null,
      pollType: 'datetime',
    });
    let active = draft;
    if (title) {
      const updated = DraftService.setTitle(draft.id, user.id, title);
      if (updated) active = updated;
    }
    const locale = normalizeLocale(from.language_code);
    const sessionKey = this.#key(dmChatId, from.id);
    const session = {
      chatId: dmChatId,
      publishChatId: publishChatId ?? null,
      fromId: from.id,
      draftId: draft.id,
      authorId: user.id,
      step: STEP.DAYS,
      dayIndex: 0,
      messageId: null,
      ephemeralMessageId: null,
      receiverUserId: opts.receiverUserId ?? null,
      locale,
      calendar: currentCalendar(),
    };
    this.sessions.set(sessionKey, session);
    return {
      sessionKey,
      authorId: user.id,
      draftId: draft.id,
      content: this.#daysContent(active, session),
    };
  }

  /**
   * Re-opens an existing draft for the author, resuming the flow at the
   * day-selection step. The calendar starts on the month of the first selected
   * date so previously chosen days are visible. Returns null when the draft
   * does not belong to the user.
   * @param {string} chatId - the message showing the drafts list (the flow
   *   continues in the same chat)
   * @param {string | null} [publishChatId]
   * @param {import('node-telegram-bot-api').User} from
   * @param {import('../domains/draft/draft.entity.js').Draft} draft
   * @param {{ receiverUserId?: number, ephemeralMessageId?: number }} [opts]
   * @returns {import('./flow.entity.js').FlowResult | null}
   */
  resume(chatId, publishChatId, from, draft, opts = {}) {
    const user = UserRepository.findOrCreateBySession(
      { name: from.first_name || undefined },
      String(from.id)
    );
    if (draft.authorUserId !== user.id) return null;

    const locale = normalizeLocale(from.language_code);
    const sessionKey = this.#key(chatId, from.id);
    const session = {
      chatId,
      publishChatId: publishChatId ?? null,
      fromId: from.id,
      draftId: draft.id,
      authorId: user.id,
      step: STEP.DAYS,
      dayIndex: 0,
      messageId: null,
      ephemeralMessageId: opts.ephemeralMessageId ?? null,
      receiverUserId: opts.receiverUserId ?? null,
      locale,
      calendar: calendarForDraft(draft),
    };
    this.sessions.set(sessionKey, session);
    return this.#render(session, this.#daysContent(draft, session));
  }

  /**
   * Returns the chat and message addressing currently driving the interactive
   * flow for a session key, or null. `messageId` addresses a regular message;
   * `ephemeralMessageId` + `receiverUserId` address an ephemeral group form.
   * @param {string} sessionKey
   * @returns {{
   *   chatId: string,
   *   messageId: number | null,
   *   ephemeralMessageId: number | null,
   *   receiverUserId: number | null
   * } | null}
   */
  getMessage(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    return {
      chatId: session.chatId,
      messageId: session.messageId,
      ephemeralMessageId: session.ephemeralMessageId,
      receiverUserId: session.receiverUserId,
    };
  }

  /**
   * Records the message id of the interactive flow message after it is first
   * sent, so later steps can edit it in place.
   * @param {string} sessionKey
   * @param {number} messageId
   */
  setMessageId(sessionKey, messageId) {
    const session = this.sessions.get(sessionKey);
    if (session) session.messageId = messageId;
  }

  /**
   * Records the ephemeral message id of an ephemeral flow form in a group
   * chat (sender-visible only), so later steps can edit it in place.
   * @param {string} sessionKey
   * @param {number} ephemeralMessageId
   */
  setEphemeralMessageId(sessionKey, ephemeralMessageId) {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.ephemeralMessageId = ephemeralMessageId;
      session.messageId = null;
    }
  }

  /**
   * Handles a callback query carrying one of our inline buttons.
   * @param {string} chatId
   * @param {number} fromId
   * @param {string} data
   * @returns {import('./flow.entity.js').FlowResult | null}
   */
  onCallback(chatId, fromId, data) {
    const session = this.sessions.get(this.#key(chatId, fromId));
    if (!session) return null;

    const decoded = decodeCallback(data);
    if (!decoded) return null;

    return this.#dispatch(session, decoded);
  }

  /**
   * @param {import('./flow.entity.js').FlowSession} session
   * @param decoded
   */
  #dispatch(session, decoded) {
    switch (decoded.type) {
      case 'day': {
        const draft = DraftService.toggleDate(session.draftId, session.authorId, decoded.date);
        if (!draft) return null;
        return this.#render(session, this.#daysContent(draft, session));
      }
      case 'month': {
        session.calendar = shiftMonth(session.calendar, decoded.dir);
        const draft = DraftService.getDraft(session.draftId, session.authorId);
        return draft ? this.#render(session, this.#daysContent(draft, session)) : null;
      }
      case 'reset':
        if (decoded.step === STEP.DAYS) {
          const draft = DraftService.resetDates(session.draftId, session.authorId);
          return draft ? this.#render(session, this.#daysContent(draft, session)) : null;
        }
        if (decoded.step === STEP.TIMES) {
          const date = sessionDate(session);
          const draft = date
            ? DraftService.resetTimeSlotsForDate(session.draftId, session.authorId, date)
            : null;
          return draft ? this.#render(session, this.#timesContent(draft, session)) : null;
        }
        return null;
      case 'ok':
        if (decoded.step === STEP.DAYS) return this.#advanceToTimes(session);
        if (decoded.step === STEP.TIMES) return this.#advanceTimes(session);
        return null;
      case 'slot': {
        const draft = DraftService.toggleTimeSlot(session.draftId, session.authorId, {
          date: decoded.date,
          start: decoded.start,
          end: addMinutes(decoded.start, 30),
        });
        return draft ? this.#render(session, this.#timesContent(draft, session)) : null;
      }
      case 'nav': {
        const dates = sessionDates(session);
        if (dates.length === 0) return null;
        if (decoded.dir === 'prev' && session.dayIndex > 0) session.dayIndex -= 1;
        if (decoded.dir === 'next' && session.dayIndex < dates.length - 1) session.dayIndex += 1;
        const draft = DraftService.getDraft(session.draftId, session.authorId);
        return draft ? this.#render(session, this.#timesContent(draft, session)) : null;
      }
      case 'back': {
        const draft = DraftService.getDraft(session.draftId, session.authorId);
        if (!draft) return null;
        session.step = STEP.DAYS;
        session.dayIndex = 0;
        return this.#render(session, this.#daysContent(draft, session));
      }
      case 'remove': {
        const draft = DraftService.getDraft(session.draftId, session.authorId);
        if (!draft) return null;
        DraftService.deleteDraft(session.draftId, session.authorId);
        const key = this.#key(session.chatId, session.fromId);
        this.sessions.delete(key);
        const content = { text: getTranslator(session.locale)('draftRemoved') };
        return {
          type: 'removed',
          published: false,
          poll: null,
          content,
          sessionKey: key,
          publishChatId: session.publishChatId,
        };
      }
      default:
        return null;
    }
  }

  /** @param {import('./flow.entity.js').FlowSession} session */
  #advanceToTimes(session) {
    const draft = DraftService.getDraft(session.draftId, session.authorId);
    if (!draft || draft.selectedDates.length === 0) {
      return draft ? this.#render(session, this.#daysContent(draft, session)) : null;
    }
    session.step = STEP.TIMES;
    session.dayIndex = 0;
    return this.#render(session, this.#timesContent(draft, session));
  }

  /** @param {import('./flow.entity.js').FlowSession} session */
  #advanceTimes(session) {
    const draft = DraftService.getDraft(session.draftId, session.authorId);
    if (!draft) return null;

    if (session.dayIndex < draft.selectedDates.length - 1) {
      session.dayIndex += 1;
      return this.#render(session, this.#timesContent(draft, session));
    }

    const poll = DraftService.publishDraft(session.draftId, session.authorId);
    if (!poll) return this.#render(session, this.#timesContent(draft, session));
    const view = buildPollView(poll, String(session.fromId));
    const formChatId = session.chatId;
    const formMessageId = session.messageId;
    const formEphemeralMessageId = session.ephemeralMessageId;
    const formReceiverUserId = session.receiverUserId;
    this.sessions.delete(this.#key(session.chatId, session.fromId));
    return {
      type: 'done',
      published: true,
      poll,
      publishChatId: session.publishChatId ?? session.chatId,
      formChatId,
      formMessageId,
      formEphemeralMessageId,
      formReceiverUserId,
      content: buildPollMessage(view, session.locale),
    };
  }

  /**
   * @param draft
   * @param {import('./flow.entity.js').FlowSession} session
   */
  #daysContent(draft, session) {
    return buildDaysMessage(draft, session.calendar, session.locale);
  }

  /**
   * @param draft
   * @param {import('./flow.entity.js').FlowSession} session
   */
  #timesContent(draft, session) {
    const dates = draft.selectedDates;
    if (dates.length === 0) return this.#daysContent(draft, session);
    const index = Math.min(session.dayIndex, dates.length - 1);
    session.dayIndex = index;
    return buildTimesMessage(draft, index, TIME_SLOTS, session.locale);
  }

  /**
   * Drops any active session for a chat+user, e.g. after cancellation.
   * @param {string} chatId
   * @param {number} fromId
   */
  clear(chatId, fromId) {
    this.sessions.delete(this.#key(chatId, fromId));
  }

  /**
   * @param {import('./flow.entity.js').FlowSession} session
   * @param content
   */
  #render(session, content) {
    return {
      type: 'render',
      published: false,
      poll: null,
      content,
      sessionKey: this.#key(session.chatId, session.fromId),
      publishChatId: session.publishChatId,
    };
  }

  /**
   * @param {string} chatId @param {number} fromId
   * @param fromId
   */
  #key(chatId, fromId) {
    return `${chatId}:${fromId}`;
  }
}

/** @param {import('./flow.entity.js').FlowSession} session @returns {string | null} */
function sessionDate(session) {
  return sessionDates(session)[session.dayIndex] ?? null;
}

/** @param {import('./flow.entity.js').FlowSession} session @returns {Array<string>} */
function sessionDates(session) {
  const draft = DraftService.getDraft(session.draftId, session.authorId);
  return draft ? draft.selectedDates : [];
}

/**
 * Adds `minutes` to an HH:MM time, returning HH:MM (24h).
 * @param {string} hhmm
 * @param {number} minutes
 * @returns {string}
 */
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Returns the calendar month to open when resuming a draft: the month of its
 * first selected date, or the current month when nothing is selected yet.
 * @param {import('../domains/draft/draft.entity.js').Draft} draft
 * @returns {{ year: number, monthIndex: number }}
 */
function calendarForDraft(draft) {
  const first = draft.selectedDates[0];
  if (first) {
    const [year, month] = first.split('-').map(Number);
    if (Number.isFinite(year) && Number.isFinite(month)) return { year, monthIndex: month - 1 };
  }
  return currentCalendar();
}
