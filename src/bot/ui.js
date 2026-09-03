import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatDisplayDate } from './slots.js';
import { calendarGrid } from './calendar.js';
import { getTranslator } from './i18n.js';
import { config } from '../config/index.js';
import { expandSlots, mergeSlots, countUnits, formatSlot } from '../domains/draft/draft-slot.js';
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
import { htmlTexts, htmlButtons } from './html-helpers.js';

const pollResultsTemplate = Handlebars.compile(
  readFileSync(fileURLToPath(new URL('./templates/poll-results.hbs', import.meta.url)), 'utf8'),
);
const pollStageTemplate = Handlebars.compile(
  readFileSync(fileURLToPath(new URL('./templates/poll-stage.hbs', import.meta.url)), 'utf8'),
);
const calendarTemplate = Handlebars.compile(
  readFileSync(fileURLToPath(new URL('./templates/calendar.hbs', import.meta.url)), 'utf8'),
);
const timesTemplate = Handlebars.compile(
  readFileSync(fileURLToPath(new URL('./templates/times.hbs', import.meta.url)), 'utf8'),
);
const draftsTemplate = Handlebars.compile(
  readFileSync(fileURLToPath(new URL('./templates/drafts.hbs', import.meta.url)), 'utf8'),
);

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
    d.getDate(),
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

  const weeks = grid.weeks.map((week) =>
    week.map((cell) => {
      if (!cell.isoDate) return { blank: true };
      const past = cell.isoDate < today;
      const active = selected.has(cell.isoDate);
      const disabled = past || (atLimit && !active);
      return {
        day: String(cell.day),
        cb: disabled ? '' : dayCallback(cell.isoDate),
        active,
      };
    }),
  );

  const canOk = selected.size > 0;
  const selectedLabel =
    selected.size === 0
      ? t('none')
      : [...selected].map((d) => formatDisplayDate(d, locale)).join(', ');

  return {
    rich_message: {
      html: calendarTemplate({
        title: draft.title ? `<b>${draft.title}</b>` : `<i>${t('untitled')}</i>`,
        monthTitle: grid.title,
        prevMonth: monthCallback(-1),
        nextMonth: monthCallback(1),
        weekdays: grid.weekdays,
        weeks,
        canOk,
        okCb: okCallback(STEP.DAYS),
        resetCb: resetCallback(STEP.DAYS),
        ok: t('ok'),
        reset: t('reset'),
        removeCb: removeDraftCallback(),
        remove: t('remove'),
        pickDays: t('pickDays'),
        selectedCaption:
          t('selectedInMax', { n: selected.size, max: maxDays }) + ' ' + selectedLabel,
      }),
    },
  };
}

/**
 * Collects every interactive `<td button="...">` cell from an HTML rich
 * message.
 * @param {{ rich_message: { html: string } }} content
 * @returns {Array<{ text: string, label: string, callback_data: string }>}
 */
export function richButtons(content) {
  return htmlButtons(content.rich_message.html);
}

/**
 * Collects the plain text of an HTML rich message as a single joined string.
 * @param {{ rich_message: { html: string } }} content
 * @returns {Array<string>}
 */
export function richTexts(content) {
  const text = htmlTexts(content.rich_message.html);
  return text.length ? [text] : [];
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
  maxPerDay = config.maxSlotsPerDay,
) {
  const t = getTranslator(locale);
  const dates = draft.selectedDates;
  const date = dates[dayIndex] ?? dates[0];
  if (!date) {
    return { rich_message: { html: `<p>${t('noDays')}</p>` } };
  }

  const selectedForDate = draft.timeSlots.filter((slot) => slot.date === date);
  const chosenUnits = expandSlots(selectedForDate);
  const selectedIntervals = mergeSlots(selectedForDate);
  const chosenSize = countUnits(selectedForDate);
  const atLimit = chosenSize >= maxPerDay;

  const prevDisabled = dayIndex === 0;
  const nextDisabled = dayIndex === dates.length - 1;

  const slotRows = [];
  for (let i = 0; i < timeSlots.length; i += 3) {
    slotRows.push(
      timeSlots.slice(i, i + 3).map((slot) => {
        const active = chosenUnits.some((u) => u.start === slot.start && u.end === slot.end);
        const disabled = atLimit && !active;
        return {
          label: formatSlot(slot),
          cb: disabled ? '' : slotCallback(date, slot.start),
          active,
        };
      }),
    );
  }

  const selectedLabel =
    selectedIntervals.length === 0 ? t('none') : selectedIntervals.map(formatSlot).join(', ');

  return {
    rich_message: {
      html: timesTemplate({
        date: formatDisplayDate(date, locale),
        pickSlots: t('pickSlots'),
        prevDisabled,
        prevCb: navCallback('prev'),
        nextDisabled,
        nextCb: navCallback('next'),
        noopCb: noopCallback(),
        dayCount: `${dayIndex + 1}/${dates.length}`,
        slotRows,
        backCb: backCallback(),
        back: t('back'),
        canOk: chosenSize > 0,
        okCb: okCallback(STEP.TIMES),
        resetCb: resetCallback(STEP.TIMES),
        ok: t('ok'),
        reset: t('reset'),
        removeCb: removeDraftCallback(),
        remove: t('remove'),
        selectedCaption: `${t('selectedInMax', { n: chosenSize, max: maxPerDay })} ${selectedLabel}`,
      }),
    },
  };
}

/**
 * Builds the live poll screen as a RICH MESSAGE. When the viewer can still vote
 * (staging view), each option row shows its live Yes/Maybe/No counts and one
 * stage button per response. Pressing a stage button moves the viewer into a
 * per-user staging panel (`staged` is a Map of option id -> response),
 * highlighting the choice and showing global Confirm / Cancel buttons below.
 * When the poll is closed or the viewer has already voted (results view),
 * intervals and counts are rendered as a table grouped by date.
 * @param {ReturnType<import('./poll-view.js').buildPollView>} view
 * @param {string} [locale]
 * @param {Map<string, import('../domains/vote/vote.entity.js').VoteResponse> | null} [staged]
 * @returns {{ rich_message: import('node-telegram-bot-api').InputRichMessage }}
 */
export function buildPollMessage(view, locale = 'en', staged = null) {
  const t = getTranslator(locale);
  const { poll, rows } = view;
  const open = VoteService.canVote(poll);

  const isResults = !open || view.voted;

  if (isResults) {
    const dateGroups = [];
    let lastDate = null;
    let group = null;
    for (const row of rows) {
      if (row.date !== lastDate) {
        group = { date: formatDisplayDate(row.date, locale), rows: [] };
        dateGroups.push(group);
        lastDate = row.date;
      }
      const max = Math.max(row.counts.yes, row.counts.maybe, row.counts.no);
      const bold = (n) => (n === max && max > 0 ? `<b>${n}</b>` : String(n));
      group.rows.push({
        interval: `${row.start}\u2013${row.end}`,
        yes: bold(row.counts.yes),
        maybe: bold(row.counts.maybe),
        no: bold(row.counts.no),
      });
    }
    return {
      rich_message: {
        html: pollResultsTemplate({
          title: poll.title,
          dateGroups,
          participants: `${t('participants')} ${view.participantCount}`,
        }),
      },
    };
  }

  const dateGroups = [];
  let lastDate = null;
  let group = null;
  for (const row of rows) {
    if (row.date !== lastDate) {
      group = { date: formatDisplayDate(row.date, locale), rows: [] };
      dateGroups.push(group);
      lastDate = row.date;
    }
    const choice = staged ? choiceFor(staged, row) : undefined;
    group.rows.push({
      interval: `${row.start}\u2013${row.end}`,
      yesCb: stageCallback(poll.id, row.index, 'yes'),
      maybeCb: stageCallback(poll.id, row.index, 'maybe'),
      noCb: stageCallback(poll.id, row.index, 'no'),
      yesSel: choice === 'yes',
      maybeSel: choice === 'maybe',
      noSel: choice === 'no',
    });
  }

  const noAnswers = !staged || staged.size === 0;
  return {
    rich_message: {
      html: pollStageTemplate({
        title: poll.title,
        dateGroups,
        canConfirm: open && !view.voted,
        canConfirmVote: open && !view.voted && !noAnswers,
        confirmCb: voteConfirmCallback(poll.id),
        cancelCb: voteCancelCallback(poll.id),
        confirm: `${t('confirm')} \u2713`,
        cancel: `${t('cancel')} \u2717`,
        participants: `${t('participants')} ${view.participantCount}`,
      }),
    },
  };
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

  if (drafts.length === 0) {
    return {
      rich_message: {
        html: draftsTemplate({
          draftsTitle: t('draftsTitle'),
          empty: true,
          noDrafts: t('noDrafts'),
        }),
      },
    };
  }

  const rows = drafts.map((draft) => {
    const title = draft.title || t('untitled');
    const summary = `${t('daysShort', { n: draft.selectedDates.length })} \u00B7 ${t('slotsShort', {
      n: countUnits(draft.timeSlots),
    })}`;
    return {
      title,
      summary,
      createdLabel: draft.createdAt
        ? t('createdOn', { date: String(draft.createdAt).slice(0, 10) })
        : '',
      continueCb: editDraftCallback(draft.id),
      deleteCb: deleteDraftCallback(draft.id),
    };
  });

  return {
    rich_message: {
      html: draftsTemplate({
        draftsTitle: t('draftsTitle'),
        empty: false,
        deleteAllCb: deleteAllDraftsCallback(),
        deleteAll: t('deleteAllDrafts'),
        drafts: rows,
        continueBtn: t('continue'),
        deleteDraft: t('deleteDraft'),
      }),
    },
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
