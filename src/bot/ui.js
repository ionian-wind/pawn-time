import { RichMessageBuilder, RichTextBuilder, richMessageButton } from 'node-telegram-bot-api';
import { formatDisplayDate } from './slots.js';
import { calendarGrid } from './calendar.js';
import { getTranslator } from './i18n.js';
import { config } from '../config/index.js';
import {
  dayCallback,
  slotCallback,
  okCallback,
  resetCallback,
  navCallback,
  monthCallback,
  backCallback,
  stageCallback,
  voteConfirmCallback,
  voteCancelCallback,
  noopCallback,
  editDraftCallback,
  deleteDraftCallback,
  deleteAllDraftsCallback,
  removeDraftCallback,
  STEP,
} from './callback-data.js';
import { VoteService } from '../domains/vote/vote.service.js';

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
 * to switch between months, plus (OK) / (Reset) — disabled until a day is
 * selected.
 * @param {import('../domains/draft/draft.entity.js').Draft} draft
 * @param {{ year: number, monthIndex: number }} calendar - visible month
 * @param {string} [locale]
 * @param maxDays
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildDaysMessage(draft, calendar, locale = 'en', maxDays = config.maxScheduleDays) {
  const t = getTranslator(locale);
  const selected = new Set(draft.selectedDates);
  const grid = calendarGrid(calendar, locale);
  const today = startOfTodayIso();
  const atLimit = selected.size >= maxDays;

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
        const past = cell.isoDate < today; // past dates are not schedulable
        const active = selected.has(cell.isoDate);
        const disabled = past || (atLimit && !active); // no more picks once at the day limit
        const options = disabled ? { disabled: {} } : { callback_data: dayCallback(cell.isoDate) };
        return richMessageButton(`${active ? '\u2611 ' : ''}${cell.day}`, options);
      })
    );
  }

  builder.buttons([
    richMessageButton(`${t('ok')} \u2713`, {
      ...(selected.size === 0 ? { disabled: {} } : { callback_data: okCallback(STEP.DAYS) }),
    }),
    richMessageButton(t('reset'), {
      ...(selected.size === 0 ? { disabled: {} } : { callback_data: resetCallback(STEP.DAYS) }),
    }),
    richMessageButton(`${t('remove')} \u2715`, { callback_data: removeDraftCallback() }),
  ]);

  const selectedLabel =
    selected.size === 0
      ? t('none')
      : [...selected].map((d) => formatDisplayDate(d, locale)).join(', ');
  builder.paragraph(
    `${t('pickDays')}\n${t('selectedInMax', { n: selected.size, max: maxDays })} ${selectedLabel}`
  );

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
 * (OK) / (Reset) below — both disabled until a slot is chosen.
 * @param {import('../domains/draft/draft.entity.js').Draft} draft
 * @param {number} dayIndex - index into draft.selectedDates
 * @param {Array<{ start: string, end: string }>} timeSlots
 * @param {string} [locale]
 * @param maxPerDay
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildTimesMessage(
  draft,
  dayIndex,
  timeSlots,
  locale = 'en',
  maxPerDay = config.maxSlotsPerDay
) {
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
  const atLimit = chosen.size >= maxPerDay;

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
        const disabled = atLimit && !active; // no more picks once at this day's slot limit
        const options = disabled
          ? { disabled: {} }
          : { callback_data: slotCallback(date, slot.start) };
        const label = `${active ? '\u25A3' : '\u25A2'} ${slot.start}`;
        return richMessageButton(label, options);
      })
    );
  }

  builder.buttons([
    richMessageButton(`${t('back')} \u2190`, { callback_data: backCallback() }),
    richMessageButton(`${t('ok')} \u2713`, {
      ...(chosen.size === 0 ? { disabled: {} } : { callback_data: okCallback(STEP.TIMES) }),
    }),
    richMessageButton(t('reset'), {
      ...(chosen.size === 0 ? { disabled: {} } : { callback_data: resetCallback(STEP.TIMES) }),
    }),
    richMessageButton(`${t('remove')} \u2715`, { callback_data: removeDraftCallback() }),
  ]);

  const selectedLabel = chosen.size === 0 ? t('none') : [...chosen].sort().join(', ');
  builder.paragraph(`${t('selectedInMax', { n: chosen.size, max: maxPerDay })} ${selectedLabel}`);

  return { rich_message: builder.build() };
}

/**
 * Builds the live poll screen as a RICH MESSAGE. Each option row shows its live
 * Yes/Maybe/No counts and one stage button per response. Pressing a stage
 * button moves the viewer into a per-user staging panel (`staged` is a Map of
 * option id -> response), highlighting the choice and showing global Confirm /
 * Cancel buttons below. Staged choices are never applied until Confirm is
 * pressed; choosing the same response again removes it from the staged set.
 * Once the viewer has voted a row (or the poll is closed), the row collapses
 * to its totals and the stage buttons are hidden.
 * @param {ReturnType<import('./poll-view.js').buildPollView>} view
 * @param {string} [locale]
 * @param {Map<string, import('../domains/vote/vote.entity.js').VoteResponse> | null} [staged]
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildPollMessage(view, locale = 'en', staged = null) {
  const t = getTranslator(locale);
  const { poll, rows } = view;
  const open = VoteService.canVote(poll);

  const builder = new RichMessageBuilder().paragraph(new RichTextBuilder().bold(poll.title));

  if (staged) builder.paragraph(t('stagedHint'));

  let lastDate = null;
  for (const row of rows) {
    if (row.date !== lastDate) {
      builder.paragraph(new RichTextBuilder().bold(formatDisplayDate(row.date, locale)));
      lastDate = row.date;
    }

    const label = `${row.start}\u2013${row.end}`;
    const counts = `\u2713${row.counts.yes}  ~${row.counts.maybe}  \u2717${row.counts.no}`;
    const result = new RichTextBuilder().bold(label).plain(`  ${counts}`);

    if (staged) {
      const choice = choiceFor(staged, row);
      builder.paragraph(result);
      builder.buttons([
        richMessageButton('\u2713', {
          callback_data: stageCallback(poll.id, row.index, 'yes'),
          ...(choice === 'yes' ? { style: 'primary' } : {}),
        }),
        richMessageButton('~', {
          callback_data: stageCallback(poll.id, row.index, 'maybe'),
          ...(choice === 'maybe' ? { style: 'primary' } : {}),
        }),
        richMessageButton('\u2717', {
          callback_data: stageCallback(poll.id, row.index, 'no'),
          ...(choice === 'no' ? { style: 'primary' } : {}),
        }),
      ]);
    } else if (row.mine || view.voted || !open) {
      // already voted (this row or anywhere in the poll, or the poll is closed):
      // totals only, no stage buttons
      builder.paragraph(result);
    } else {
      builder.paragraph(result);
      builder.buttons([
        richMessageButton('\u2713', { callback_data: stageCallback(poll.id, row.index, 'yes') }),
        richMessageButton('~', { callback_data: stageCallback(poll.id, row.index, 'maybe') }),
        richMessageButton('\u2717', { callback_data: stageCallback(poll.id, row.index, 'no') }),
      ]);
    }
  }

  if (staged) {
    builder.buttons([
      richMessageButton(`${t('confirm')} \u2713`, {
        callback_data: voteConfirmCallback(poll.id),
      }),
      richMessageButton(`${t('cancel')} \u2717`, { callback_data: voteCancelCallback(poll.id) }),
    ]);
  }

  builder.paragraph(`${t('participants')} ${view.participantCount}`);

  return { rich_message: builder.build() };
}

/**
 * The uniform staged response for a row, or undefined when not all slots of the
 * row share one staged response.
 * @param {Map<string, import('../domains/vote/vote.entity.js').VoteResponse>} staged
 * @param {ReturnType<import('./poll-view.js').buildPollView>['rows'][number]} row
 * @returns {import('../domains/vote/vote.entity.js').VoteResponse | undefined}
 */
function choiceFor(staged, row) {
  let choice;
  for (const id of row.ids) {
    const current = staged.get(id);
    if (current === undefined) return undefined;
    if (choice === undefined) choice = current;
    else if (choice !== current) return undefined;
  }
  return choice;
}

/**
 * Builds the /drafts list as a RICH MESSAGE: one block per draft with its
 * title, size summary and created date, plus "Continue" / "Delete" buttons.
 * @param {Array<import('../domains/draft/draft.entity.js').Draft>} drafts - most recent first
 * @param {string} [locale]
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildDraftsMessage(drafts, locale = 'en') {
  const t = getTranslator(locale);
  const builder = new RichMessageBuilder().paragraph(new RichTextBuilder().bold(t('draftsTitle')));

  if (drafts.length === 0) {
    builder.paragraph(t('noDrafts'));
    return { rich_message: builder.build() };
  }

  builder.buttons([
    richMessageButton(t('deleteAllDrafts'), { callback_data: deleteAllDraftsCallback() }),
  ]);

  for (const draft of drafts) {
    const title = draft.title || t('untitled');
    const summary = `${t('daysShort', { n: draft.selectedDates.length })} \u00B7 ${t('slotsShort', {
      n: draft.timeSlots.length,
    })}`;
    builder.paragraph(new RichTextBuilder().bold(title).plain(` \u2014 ${summary}`));

    if (draft.createdAt) {
      builder.paragraph(`${t('createdOn', { date: String(draft.createdAt).slice(0, 10) })}`);
    }

    builder.buttons([
      richMessageButton(`${t('continue')}`, {
        callback_data: editDraftCallback(draft.id),
      }),
      richMessageButton(`${t('deleteDraft')}`, {
        callback_data: deleteDraftCallback(draft.id),
      }),
    ]);
  }

  return { rich_message: builder.build() };
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
