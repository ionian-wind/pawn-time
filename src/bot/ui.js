import { RichMessageBuilder, RichTextBuilder, richMessageButton } from 'node-telegram-bot-api';
import { formatDisplayDate } from './slots.js';
import { calendarGrid } from './calendar.js';
import { getTranslator } from './i18n.js';
import {
  dayCallback,
  slotCallback,
  okCallback,
  resetCallback,
  navCallback,
  monthCallback,
  backCallback,
  noopCallback,
  STEP,
} from './callback-data.js';

/**
 * Rich fragments used inside the HTML message bodies. The bot uses classic
 * HTML formatting in the message text together with inline buttons: this is the
 * "hybrid" approach (rich message body + interactive inline buttons).
 */

/**
 * Today's date as a local `YYYY-MM-DD` string (start of day), used to grey out
 * past days on the calendar.
 * @returns {string}
 */
function startOfTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Builds the day-selection screen as a RICH MESSAGE styled like a calendar: a
 * weekday header row, the month's day grid (7 columns), and arrow buttons below
 * to switch between months, plus (OK) / (Reset).
 * @param {import('../domains/draft/draft.entity.js').Draft} draft
 * @param {{ year: number, monthIndex: number }} calendar - visible month
 * @param {string} [locale]
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildDaysMessage(draft, calendar, locale = 'en') {
  const t = getTranslator(locale);
  const selected = new Set(draft.selectedDates);
  const grid = calendarGrid(calendar, locale);
  const today = startOfTodayIso();

  const title = new RichTextBuilder();
  if (draft.title) title.bold(draft.title);
  else title.italic(t('untitled'));

  const builder = new RichMessageBuilder().paragraph(title);

  builder.heading(grid.title, 3);

  builder.buttons([
    richMessageButton('\u25C0', { callback_data: monthCallback(-1) }),
    richMessageButton('\u25B6', { callback_data: monthCallback(1) }),
  ]);

  builder.buttons(grid.weekdays.map((wd) => richMessageButton(wd, { disabled: {} })));

  for (const week of grid.weeks) {
    builder.buttons(
      week.map((cell) => {
        if (!cell.isoDate) return richMessageButton('\u00A0', { disabled: {} });
        const disabled = cell.isoDate < today; // past dates are not schedulable
        const active = selected.has(cell.isoDate);
        const options = disabled ? { disabled: {} } : { callback_data: dayCallback(cell.isoDate) };
        return richMessageButton(`${active ? '\u2611 ' : ''}${cell.day}`, options);
      })
    );
  }

  builder.buttons([
    richMessageButton(`${t('ok')} \u2713`, { callback_data: okCallback(STEP.DAYS) }),
    richMessageButton(t('reset'), { callback_data: resetCallback(STEP.DAYS) }),
  ]);

  const selectedLabel =
    selected.size === 0
      ? t('none')
      : [...selected].map((d) => formatDisplayDate(d, locale)).join(', ');
  builder.paragraph(`${t('pickDays')}\n${t('selected')} ${selectedLabel}`);

  return { rich_message: builder.build() };
}

/**
 * Collects every button from a rich message's `buttons` blocks, in order.
 * @param {{ rich_message: import('node-telegram-bot-api').InputRichMessage }} content
 * @returns {Array<import('node-telegram-bot-api').RichMessageButton>}
 */
export function richButtons(content) {
  const blocks = content.rich_message?.blocks ?? [];
  return blocks.filter((block) => block.type === 'buttons').flatMap((block) => block.buttons);
}

/**
 * Collects the plain text of a rich message's text-bearing blocks, in order.
 * Nested rich-text nodes (bold, italic, ...) are flattened into their leaf
 * strings.
 * @param {{ rich_message: import('node-telegram-bot-api').InputRichMessage }} content
 * @returns {Array<string>}
 */
export function richTexts(content) {
  const blocks = content.rich_message?.blocks ?? [];
  return blocks
    .map((block) => block.text)
    .filter((text) => text != null && text !== '')
    .map(flattenRichText);
}

/**
 * Recursively flattens a RichText tree into its plain string leaves.
 * @param {import('node-telegram-bot-api').RichText} text
 * @returns {string}
 */
function flattenRichText(text) {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.map(flattenRichText).join('');
  if (text && typeof text === 'object' && typeof text.text !== 'undefined') {
    return flattenRichText(text.text);
  }
  return '';
}

/**
 * Builds the time-selection screen for a single (current) day as a RICH
 * MESSAGE: a 30-minute interval grid (3 columns), arrow buttons to navigate
 * between the selected days, a (Back) button returning to day selection, and
 * (OK) / (Reset) below.
 * @param {import('../domains/draft/draft.entity.js').Draft} draft
 * @param {number} dayIndex - index into draft.selectedDates
 * @param {Array<{ start: string, end: string }>} timeSlots
 * @param {string} [locale]
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildTimesMessage(draft, dayIndex, timeSlots, locale = 'en') {
  const t = getTranslator(locale);
  const dates = draft.selectedDates;
  const date = dates[dayIndex] ?? dates[0];
  if (!date) {
    const builder = new RichMessageBuilder().paragraph(`${t('noDays')}`);
    return { rich_message: builder.build() };
  }

  const chosen = new Set(
    draft.timeSlots.filter((slot) => slot.date === date).map((slot) => slot.start)
  );

  const builder = new RichMessageBuilder().heading(
    new RichTextBuilder().bold(formatDisplayDate(date, locale)),
    3
  );
  builder.paragraph(t('pickSlots'));

  const prevDisabled = dayIndex === 0;
  const nextDisabled = dayIndex === dates.length - 1;
  builder.buttons([
    prevDisabled
      ? richMessageButton('\u2500', { disabled: {} })
      : richMessageButton('\u25C0', { callback_data: navCallback('prev') }),
    richMessageButton(`${dayIndex + 1}/${dates.length}`, { callback_data: noopCallback() }),
    nextDisabled
      ? richMessageButton('\u2500', { disabled: {} })
      : richMessageButton('\u25B6', { callback_data: navCallback('next') }),
  ]);

  for (let i = 0; i < timeSlots.length; i += 3) {
    builder.buttons(
      timeSlots.slice(i, i + 3).map((slot) => {
        const active = chosen.has(slot.start);
        const label = `${active ? '\u25A3' : '\u25A2'} ${slot.start}`;
        return richMessageButton(label, { callback_data: slotCallback(date, slot.start) });
      })
    );
  }

  builder.buttons([
    richMessageButton(`${t('back')} \u2190`, { callback_data: backCallback() }),
    richMessageButton(`${t('ok')} \u2713`, { callback_data: okCallback(STEP.TIMES) }),
    richMessageButton(t('reset'), { callback_data: resetCallback(STEP.TIMES) }),
  ]);

  const selectedLabel = chosen.size === 0 ? t('none') : [...chosen].sort().join(', ');
  builder.paragraph(`${t('selected')} ${selectedLabel}`);

  return { rich_message: builder.build() };
}

/**
 * Builds the final "published" announcement for a poll.
 * @param {import('../domains/poll/poll.entity.js').PollWithStats} poll
 * @param {string} [locale]
 * @returns {{ text: string, reply_markup: { inline_keyboard: Array<Array<Object>> } }}
 */
export function buildPublishedMessage(poll, locale = 'en') {
  const t = getTranslator(locale);
  const options = poll.options
    .map(
      (opt) =>
        `\u2022 ${formatDisplayDate(opt.date, locale)} ${opt.startTime} \u2013 ${opt.endTime}`
    )
    .join('\n');
  return {
    text: `<b>${esc(poll.title)}</b> ${t('isLive')}\n\n${options}\n\n${t('share')}`,
    reply_markup: { inline_keyboard: [] },
  };
}

/**
 * Escapes text for safe use inside an HTML message body.
 * @param {string} value
 * @returns {string}
 */
function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export { esc };
