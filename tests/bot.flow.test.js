import { closeDatabase } from '../src/db/database.js';
import { FlowManager } from '../src/bot/flow.js';
import { decodeCallback } from '../src/bot/callback-data.js';
import { generateTimeSlots, formatDisplayDate, toIsoDate } from '../src/bot/slots.js';
import { richButtons, richTexts } from '../src/bot/ui.js';
import { currentCalendar, shiftMonth, calendarGrid } from '../src/bot/calendar.js';
import { DraftService } from '../src/index.js';

function fromUser(id, first_name = 'Alice') {
  return { id, first_name, last_name: '' };
}

function allButtons(content) {
  if (content.rich_message) {
    return richButtons(content).filter((b) => typeof b.callback_data === 'string');
  }
  return (content.reply_markup?.inline_keyboard ?? []).flat();
}

function dayButtons(content) {
  return allButtons(content).filter((btn) => decodeCallback(btn.callback_data)?.type === 'day');
}

function buttonWith(content, predicate) {
  return allButtons(content).find((btn) => predicate(decodeCallback(btn.callback_data)));
}

function okFor(content, step) {
  return buttonWith(content, (d) => d?.type === 'ok' && d.step === step)?.callback_data;
}

function timesCurrentDay(content) {
  // the first text-bearing block of the times screen is the day heading
  return richTexts(content)[0] ?? '';
}

afterAll(() => closeDatabase());

describe('Bot /new flow', () => {
  it('start(title) creates a draft with the title and returns the days screen', () => {
    const flow = new FlowManager();
    const alice = fromUser(111);
    const start = flow.start(String(alice.id), null, alice, 'My event');

    expect(start.content.rich_message).toBeTruthy();
    expect(richTexts(start.content).join(' ')).toContain('My event');
    expect(start.sessionKey).toBe('111:111');

    const draft = DraftService.getDraft(start.draftId, start.authorId);
    expect(draft).not.toBeNull();
    expect(draft.title).toBe('My event');
  });

  it('returns a days calendar with toggleable days', () => {
    const flow = new FlowManager();
    const alice = fromUser(222);
    const start = flow.start(String(alice.id), null, alice, 'My event');

    const days = start.content;
    expect(allButtons(days).length).toBeGreaterThan(0);

    const dayCell = dayButtons(days)[0];
    const date = decodeCallback(dayCell.callback_data).date;

    const toggled = flow.onCallback('222', 222, dayCell.callback_data);
    expect(richTexts(toggled.content).join(' ')).toContain(formatDisplayDate(date));

    const draft = DraftService.getDraft(start.draftId, start.authorId);
    expect(draft.selectedDates).toContain(date);
  });

  it('navigates calendar months with the arrow buttons', () => {
    const flow = new FlowManager();
    const alice = fromUser(777);
    const days = flow.start(String(alice.id), null, alice, 'Cal').content;
    const initialTitle = calendarGrid(currentCalendar(), 'en').title;
    expect(richTexts(days)).toContain(initialTitle);

    const next = flow.onCallback('777', 777, 'month:+1').content;
    expect(richTexts(next)).toContain(calendarGrid(shiftMonth(currentCalendar(), 1), 'en').title);
    expect(dayButtons(next).length).toBeGreaterThan(0);

    const prev = flow.onCallback('777', 777, 'month:-1').content;
    expect(richTexts(prev)).toContain(initialTitle);
  });

  it('advances to times, toggles a slot, navigates days, then publishes', () => {
    const flow = new FlowManager();
    const alice = fromUser(333);
    // start at the current month, then shift to the next month so every day is
    // selectable regardless of which day of the current month "today" is
    flow.start(String(alice.id), null, alice, 'Team sync');
    const nextMonth = flow.onCallback('333', 333, 'month:+1');
    const days = { content: nextMonth.content };
    const dates = dayButtons(days.content)
      .slice(0, 2)
      .map((b) => decodeCallback(b.callback_data).date);

    for (const date of dates) {
      const btn = dayButtons(days.content).find(
        (b) => decodeCallback(b.callback_data).date === date
      );
      days.content = flow.onCallback('333', 333, btn.callback_data).content;
    }

    // OK -> times for the first selected day
    let times = flow.onCallback('333', 333, okFor(days.content, 'days'));
    expect(times.type).toBe('render');
    expect(timesCurrentDay(times.content)).toBe(formatDisplayDate(dates[0]));

    // toggle a slot on day 1
    const slot = buttonWith(times.content, (d) => d?.type === 'slot').callback_data;
    const afterSlot = flow.onCallback('333', 333, slot);
    const filled = richButtons(afterSlot.content).find((b) =>
      b.text.includes(slot.split(':').pop())
    );
    expect(filled.text.startsWith('\u25A3')).toBe(true); // filled marker = selected

    // navigate to day 2 and select a slot there
    const nextNav = buttonWith(afterSlot.content, (d) => d?.type === 'nav' && d.dir === 'next');
    const day2 = flow.onCallback('333', 333, nextNav.callback_data);
    expect(timesCurrentDay(day2.content)).toBe(formatDisplayDate(dates[1]));

    flow.onCallback('333', 333, buttonWith(day2.content, (d) => d?.type === 'slot').callback_data);

    // OK on the last day publishes
    const done = flow.onCallback('333', 333, okFor(day2.content, 'times'));
    expect(done.type).toBe('done');
    expect(done.published).toBe(true);
    expect(done.poll.title).toBe('Team sync');
    expect(done.poll.options).toHaveLength(2);
  });

  it('returns to day selection from the times screen via back', () => {
    const flow = new FlowManager();
    const alice = fromUser(666);
    const start = flow.start(String(alice.id), null, alice, 'Back test');
    const dayCell = dayButtons(start.content)[0];
    const chosen = decodeCallback(dayCell.callback_data).date;

    flow.onCallback('666', 666, dayCell.callback_data);
    const times = flow.onCallback('666', 666, okFor(start.content, 'days'));
    expect(times.type).toBe('render');
    expect(timesCurrentDay(times.content)).toBe(formatDisplayDate(chosen));

    const back = flow.onCallback('666', 666, 'back:');
    expect(back.type).toBe('render');
    expect(dayButtons(back.content).length).toBeGreaterThan(0);

    // the previously selected day is still checked on the calendar
    const checked = richButtons(back.content).some((b) => b.text.startsWith('\u2611'));
    expect(checked).toBe(true);
  });

  it('cannot proceed to times with no days selected', () => {
    const flow = new FlowManager();
    const alice = fromUser(444);
    const days = { content: flow.start(String(alice.id), null, alice, 'Empty').content };

    const ok = flow.onCallback('444', 444, okFor(days.content, 'days'));
    expect(ok.type).toBe('render');
    expect(ok.poll).toBeNull();
    expect(ok.published).toBe(false);
  });

  it('is author-only: a different user cannot drive the session', () => {
    const flow = new FlowManager();
    const alice = fromUser(555);
    flow.start(String(alice.id), null, alice, 'Private');

    expect(flow.onCallback('666', 666, 'ac:ok:days')).toBeNull();
    expect(flow.getMessage('666:666')).toBeNull();
  });

  it('generates 30-minute time slots and decodes callbacks', () => {
    const slots = generateTimeSlots();
    expect(slots[0]).toEqual({ start: '09:00', end: '09:30' });
    expect(slots[slots.length - 1]).toEqual({ start: '21:30', end: '22:00' });

    expect(toIsoDate(new Date(2026, 8, 5))).toBe('2026-09-05');
    expect(decodeCallback('day:2026-09-05')).toEqual({ type: 'day', date: '2026-09-05' });
    expect(decodeCallback('slot:2026-09-05:10:00')).toEqual({
      type: 'slot',
      date: '2026-09-05',
      start: '10:00',
    });
    expect(decodeCallback('ok:days')).toEqual({ type: 'ok', step: 'days' });
    expect(decodeCallback('reset:times')).toEqual({ type: 'reset', step: 'times' });
    expect(decodeCallback('not-ours')).toBeNull();
    expect(decodeCallback(undefined)).toBeNull();
    expect(decodeCallback('month:+1')).toEqual({ type: 'month', dir: 1 });
    expect(decodeCallback('month:-1')).toEqual({ type: 'month', dir: -1 });
  });
});
