import { closeDatabase } from '../src/db/database.js';
import { normalizeLocale, getTranslator } from '../src/bot/i18n.js';
import {
  buildDaysMessage,
  buildTimesMessage,
  buildPollMessage,
  richButtons,
  richTexts,
} from '../src/bot/ui.js';
import { buildPollView } from '../src/bot/poll-view.js';
import { generateTimeSlots } from '../src/bot/slots.js';
import { DraftService, VoteService, UserRepository } from '../src/index.js';

/**
 *
 * @param author
 * @param extra
 */
function draftWith(author, extra = {}) {
  const draft = DraftService.createDraft({ authorUserId: author.id, ...extra });
  return { ...draft };
}

afterAll(() => closeDatabase());

describe('i18n', () => {
  it('normalizes language codes to supported locales', () => {
    expect(normalizeLocale('ru')).toBe('ru');
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale('')).toBe('en');
  });

  it('translates keys for en and ru and falls back to en for unknown keys', () => {
    expect(getTranslator('en')('ok')).toBe('OK');
    expect(getTranslator('ru')('ok')).toBe('ОК');
    expect(getTranslator('ru')('reset')).toBe('Сброс');
    expect(getTranslator('ru')('pickDays')).toContain('дней');
    expect(getTranslator('fr')('ok')).toBe('OK');
    expect(getTranslator('en')('missing.key')).toBe('missing.key');
  });
});

describe('UI localization', () => {
  it('builds a localized calendar day screen with month navigation', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    const calendar = { year: 2026, monthIndex: 8 }; // September 2026

    const en = buildDaysMessage(draft, calendar, 'en');
    expect(richTexts(en).join(' ')).toContain('Selected:');
    expect(richTexts(en).join(' ')).toContain('September 2026');
    expect(richTexts(en).join(' ')).toContain('Mon');

    const ru = buildDaysMessage(draft, calendar, 'ru');
    expect(richTexts(ru).join(' ')).toContain('Выбрано:');
    expect(richTexts(ru).join(' ')).toContain('пн');
    // nothing selected yet: OK/Reset are rendered as plain text, not buttons
    expect(richTexts(ru).join(' ')).toContain('ОК');
    expect(richButtons(ru).some((b) => /^(ok|reset):/.test(b.callback_data))).toBe(false);

    const arrows = richButtons(en).filter((b) => ['\u25C0', '\u25B6'].includes(b.text));
    expect(arrows.map((b) => b.callback_data)).toEqual(
      expect.arrayContaining(['month:-1', 'month:+1']),
    );
  });

  it('disables past days on the calendar', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);

    const past = buildDaysMessage(draft, { year: 2020, monthIndex: 0 }, 'en');
    // 'day:' callbacks are absent: every in-month day is a disabled button
    expect(
      richButtons(past).filter((b) => String(b.callback_data).startsWith('day:')),
    ).toHaveLength(0);

    const future = buildDaysMessage(draft, { year: 2099, monthIndex: 0 }, 'en');
    const dayButtons = richButtons(future).filter((b) => {
      const hasDay = String(b.callback_data).startsWith('day:');
      const isDisabledPlaceholder =
        b.text === '\u00A0' || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(b.text);
      return hasDay && !isDisabledPlaceholder;
    });
    expect(dayButtons.length).toBeGreaterThan(0);
  });

  it('localizes the times screen including its OK/Reset buttons', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.addDate(draft.id, author.id, '2026-09-01');
    const current = DraftService.getDraft(draft.id, author.id);

    const ru = buildTimesMessage(current, 0, generateTimeSlots(), 'ru');
    expect(richTexts(ru).join(' ')).toContain('слоты');
    expect(
      richButtons(ru).some((b) => b.text.includes('Назад') && b.callback_data === 'back:'),
    ).toBe(true);

    const en = buildTimesMessage(current, 0, generateTimeSlots(), 'en');
    // nothing selected yet: OK/Reset are plain text, not buttons
    expect(richTexts(en).join(' ')).toContain('OK \u2713');
    expect(richTexts(en).join(' ')).toContain('Reset');
    expect(richButtons(en).some((b) => /^(ok|reset):/.test(b.callback_data))).toBe(false);
  });

  it('labels time buttons as intervals and shows merged selections', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.addDate(draft.id, author.id, '2026-09-01');
    const current = DraftService.getDraft(draft.id, author.id);

    const en = buildTimesMessage(current, 0, generateTimeSlots(), 'en');
    const slotLabels = richButtons(en)
      .map((b) => b.text)
      .filter((text) => /^\d{2}:\d{2}–\d{2}:\d{2}$/.test(text));
    expect(slotLabels).toContain('09:00\u201309:30');

    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-01',
      start: '09:00',
      end: '09:30',
    });
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-01',
      start: '09:30',
      end: '10:00',
    });
    const chosen = DraftService.getDraft(draft.id, author.id);
    const after = buildTimesMessage(chosen, 0, generateTimeSlots(), 'en');
    // adjacent picks merge into one continuous interval in the selected summary
    expect(richTexts(after).join(' ')).toContain('09:00\u201310:00');
    expect(richTexts(after).join(' ')).not.toContain('09:00, 09:30');
  });

  it('builds the poll as date sections with grouped slots and vote/reject buttons', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.setTitle(draft.id, author.id, 'Sync');
    DraftService.addDate(draft.id, author.id, '2026-09-10');
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '09:00',
      end: '09:30',
    });
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '09:30',
      end: '10:00',
    });
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-11',
      start: '14:00',
      end: '14:30',
    });
    const poll = DraftService.publishDraft(draft.id, author.id);
    const view = buildPollView(poll, String(author.id));

    const ru = buildPollMessage(view, 'ru');
    expect(richTexts(ru).join(' ')).toContain('Участников:');

    const en = buildPollMessage(view, 'en');
    // date sections carry their own heading
    expect(richTexts(en).join(' ')).toContain('Sep 10');
    expect(richTexts(en).join(' ')).toContain('Sep 11');
    // consecutive 30-minute slots are merged into one range
    expect(richTexts(en).join(' ')).toContain('09:00\u201310:00');
    expect(richTexts(en).join(' ')).toContain('14:00\u201314:30');
    // per-row vote, maybe and reject buttons, no global Vote button
    const stageButtons = richButtons(en).filter((b) =>
      String(b.callback_data).startsWith('stage:'),
    );
    expect(stageButtons.length).toBe(6);
    expect(stageButtons.filter((b) => String(b.callback_data).endsWith(':m'))).toHaveLength(2);
    expect(richButtons(en).some((b) => String(b.callback_data).startsWith('vstart:'))).toBe(false);

    // initial view (nothing staged yet): Confirm/Cancel are visible but disabled
    // (rendered as plain text cells, not interactive buttons)
    expect(richTexts(en).join(' ')).toContain('Confirm \u2713');
    expect(richTexts(en).join(' ')).toContain('Cancel \u2717');
    expect(richButtons(en).some((b) => /^(vok|vcancel):/.test(b.callback_data))).toBe(false);

    const staged = buildPollMessage(view, 'en', new Map());
    // awaiting a vote: confirm/cancel are visible but disabled while no
    // response is staged for any option
    expect(richTexts(staged).join(' ')).toContain('Confirm \u2713');
    expect(richTexts(staged).join(' ')).toContain('Cancel \u2717');
    expect(richButtons(staged).some((b) => /^(vok|vcancel):/.test(b.callback_data))).toBe(false);

    const withChoice = buildPollMessage(view, 'en', new Map([['x', 'yes']]));
    const activeConfirm = richButtons(withChoice).find((b) => b.text === 'Confirm \u2713');
    const activeCancel = richButtons(withChoice).find((b) => b.text === 'Cancel \u2717');
    expect(activeConfirm.callback_data).toBe(`vok:${poll.id}`);
    expect(activeCancel.callback_data).toBe(`vcancel:${poll.id}`);
  });

  it('shows totals and hides the vote buttons once the viewer voted the row', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.setTitle(draft.id, author.id, 'Sync');
    DraftService.addDate(draft.id, author.id, '2026-09-10');
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '09:00',
      end: '09:30',
    });
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '09:30',
      end: '10:00',
    });
    const poll = DraftService.publishDraft(draft.id, author.id);

    const view = buildPollView(poll, String(author.id));
    for (const id of view.rows[0].ids) {
      VoteService.castVote(poll.id, String(author.id), id, 'yes');
    }

    const after = buildPollMessage(buildPollView(poll, String(author.id)), 'en');
    expect(richTexts(after).join(' ')).toContain('09:00\u201310:00 1 0 0');
    expect(richButtons(after).some((b) => String(b.callback_data).startsWith('stage:'))).toBe(
      false,
    );
  });
});

describe('OK/Reset button enablement', () => {
  it('disables OK/Reset on the days screen until a day is selected', () => {
    const author = UserRepository.create({ name: 'A' });
    const empty = draftWith(author);
    const calendar = { year: 2099, monthIndex: 0 };

    const before = buildDaysMessage(empty, calendar, 'en');
    const beforeData = richButtons(before).map((b) => String(b.callback_data));
    expect(beforeData).toEqual(expect.not.arrayContaining(['ok:days', 'reset:days']));

    const draft = DraftService.addDate(empty.id, author.id, '2099-01-05');
    const after = buildDaysMessage(draft, calendar, 'en');
    const afterData = richButtons(after).map((b) => String(b.callback_data));
    expect(afterData).toEqual(expect.arrayContaining(['ok:days', 'reset:days']));
  });

  it('disables OK/Reset on the times screen until a slot is chosen', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.addDate(draft.id, author.id, '2026-09-01');
    const current = DraftService.getDraft(draft.id, author.id);

    const before = buildTimesMessage(current, 0, generateTimeSlots(), 'en');
    const beforeData = richButtons(before).map((b) => String(b.callback_data));
    expect(beforeData).toEqual(expect.not.arrayContaining(['ok:times', 'reset:times']));

    DraftService.toggleTimeSlot(current.id, author.id, {
      date: '2026-09-01',
      start: '09:00',
      end: '09:30',
    });
    const chosen = DraftService.getDraft(current.id, author.id);
    const after = buildTimesMessage(chosen, 0, generateTimeSlots(), 'en');
    const afterData = richButtons(after).map((b) => String(b.callback_data));
    expect(afterData).toEqual(expect.arrayContaining(['ok:times', 'reset:times']));
  });
});
