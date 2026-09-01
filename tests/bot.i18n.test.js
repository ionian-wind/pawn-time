import { closeDatabase } from '../src/db/database.js';
import { normalizeLocale, getTranslator } from '../src/bot/i18n.js';
import {
  buildDaysMessage,
  buildTimesMessage,
  buildPublishedMessage,
  richButtons,
  richTexts,
} from '../src/bot/ui.js';
import { generateTimeSlots } from '../src/bot/slots.js';
import { DraftService, UserRepository } from '../src/index.js';

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
    expect(richButtons(en).some((b) => b.text === 'Mon')).toBe(true);

    const ru = buildDaysMessage(draft, calendar, 'ru');
    expect(richTexts(ru).join(' ')).toContain('Выбрано:');
    expect(richButtons(ru).some((b) => b.text === 'пн')).toBe(true);

    const okButton = richButtons(ru).find((b) => b.text.startsWith('ОК'));
    expect(okButton).toBeTruthy();

    const arrows = richButtons(en).filter((b) => ['\u25C0', '\u25B6'].includes(b.text));
    expect(arrows.map((b) => b.callback_data)).toEqual(
      expect.arrayContaining(['month:-1', 'month:+1'])
    );
  });

  it('disables past days on the calendar', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);

    const past = buildDaysMessage(draft, { year: 2020, monthIndex: 0 }, 'en');
    // 'day:' callbacks are absent: every in-month day is a disabled button
    expect(
      richButtons(past).filter((b) => String(b.callback_data).startsWith('day:'))
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
      richButtons(ru).some((b) => b.text.includes('Назад') && b.callback_data === 'back:')
    ).toBe(true);

    const en = buildTimesMessage(current, 0, generateTimeSlots(), 'en');
    const labels = richButtons(en).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(['OK \u2713', 'Reset']));
  });

  it('localizes the published poll announcement', () => {
    const author = UserRepository.create({ name: 'A' });
    const draft = draftWith(author);
    DraftService.setTitle(draft.id, author.id, 'Sync');
    DraftService.addDate(draft.id, author.id, '2026-09-10');
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '10:00',
      end: '10:30',
    });
    const poll = DraftService.publishDraft(draft.id, author.id);

    const ru = buildPublishedMessage(poll, 'ru');
    expect(ru.text).toContain('опубликован');
    expect(ru.text).toContain('Да');
    expect(ru.text).toContain('сент');

    const en = buildPublishedMessage(poll, 'en');
    expect(en.text).toContain('is live');
    expect(en.text).toContain('Yes');
  });
});
