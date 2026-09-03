import { closeDatabase } from '../src/db/database.js';
import { FlowManager } from '../src/bot/flow.js';
import { decodeCallback } from '../src/bot/callback-data.js';
import { generateTimeSlots } from '../src/bot/slots.js';
import { richButtons, richTexts } from '../src/bot/ui.js';
import { config } from '../src/config/index.js';
import { DraftService, UserRepository } from '../src/index.js';
import { countUnits } from '../src/domains/draft/draft-slot.js';

/**
 *
 * @param id
 * @param first_name
 */
function fromUser(id, first_name = 'Alice') {
  return { id, first_name, last_name: '' };
}

/**
 *
 * @param content
 */
function allButtons(content) {
  return richButtons(content).filter((b) => typeof b.callback_data === 'string');
}

/**
 *
 * @param content
 */
function dayButtons(content) {
  return allButtons(content).filter((btn) => decodeCallback(btn.callback_data)?.type === 'day');
}

/**
 *
 * @param content
 */
function slotButtons(content) {
  return allButtons(content).filter((btn) => decodeCallback(btn.callback_data)?.type === 'slot');
}

/**
 *
 * @param content
 * @param predicate
 */
function buttonWith(content, predicate) {
  return allButtons(content).find((btn) => predicate(decodeCallback(btn.callback_data)));
}

/**
 *
 * @param content
 * @param step
 */
function okFor(content, step) {
  return buttonWith(content, (d) => d?.type === 'ok' && d.step === step)?.callback_data;
}

/**
 *
 */
function createAuthor() {
  return UserRepository.create({ name: 'Bob', email: 'bob@example.com' });
}

afterAll(() => closeDatabase());

describe('scheduling limits', () => {
  it('uses 4 days and 6 slots per day by default and reads overrides from the environment', () => {
    expect(config.maxScheduleDays).toBe(4);
    expect(config.maxSlotsPerDay).toBe(6);

    const prevDays = process.env.MAX_SCHEDULE_DAYS;
    const prevSlots = process.env.MAX_SLOTS_PER_DAY;
    process.env.MAX_SCHEDULE_DAYS = '2';
    process.env.MAX_SLOTS_PER_DAY = '3';
    try {
      expect(config.maxScheduleDays).toBe(2);
      expect(config.maxSlotsPerDay).toBe(3);
    } finally {
      if (prevDays === undefined) delete process.env.MAX_SCHEDULE_DAYS;
      else process.env.MAX_SCHEDULE_DAYS = prevDays;
      if (prevSlots === undefined) delete process.env.MAX_SLOTS_PER_DAY;
      else process.env.MAX_SLOTS_PER_DAY = prevSlots;
    }
    expect(config.maxScheduleDays).toBe(4);
    expect(config.maxSlotsPerDay).toBe(6);
  });

  it('refuses to add a day beyond the configured limit and still allows removals', () => {
    const author = createAuthor();
    const draft = DraftService.createDraft({ authorUserId: author.id });
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      DraftService.addDate(draft.id, author.id, d);
    }

    const blocked = DraftService.addDate(draft.id, author.id, '2026-09-05');
    expect(blocked.selectedDates).toHaveLength(4);
    expect(blocked.selectedDates).not.toContain('2026-09-05');

    const afterToggleOff = DraftService.toggleDate(draft.id, author.id, '2026-09-01');
    expect(afterToggleOff.selectedDates).toHaveLength(3);
    const afterToggleOn = DraftService.toggleDate(draft.id, author.id, '2026-09-05');
    expect(afterToggleOn.selectedDates).toHaveLength(4);
    expect(afterToggleOn.selectedDates).toContain('2026-09-05');
  });

  it('refuses to add more than the per-day slot limit and still allows removals', () => {
    const author = createAuthor();
    const draft = DraftService.createDraft({ authorUserId: author.id });
    DraftService.addDate(draft.id, author.id, '2026-09-01');

    const slots = generateTimeSlots();
    for (let i = 0; i < 6; i += 1) {
      DraftService.toggleTimeSlot(draft.id, author.id, {
        date: '2026-09-01',
        start: slots[i].start,
        end: slots[i].end,
      });
    }
    const blocked = DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-01',
      start: slots[6].start,
      end: slots[6].end,
    });
    expect(countUnits(blocked.timeSlots.filter((s) => s.date === '2026-09-01'))).toBe(6);

    const removed = DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-01',
      start: slots[0].start,
      end: slots[0].end,
    });
    expect(countUnits(removed.timeSlots.filter((s) => s.date === '2026-09-01'))).toBe(5);
  });

  it('disables further day buttons and shows the n/max counter once the limit is reached', () => {
    const flow = new FlowManager();
    const userId = 881;
    flow.start(String(userId), null, fromUser(userId), 'Limits test');
    const session = flow.sessions.get('881:881');
    let content = flow.onCallback(String(userId), userId, 'month:+1').content;

    const dates = dayButtons(content)
      .slice(0, 4)
      .map((b) => decodeCallback(b.callback_data).date);
    for (const date of dates) {
      const btn = dayButtons(content).find((b) => decodeCallback(b.callback_data).date === date);
      content = flow.onCallback(String(userId), userId, btn.callback_data).content;
    }

    // selected days stay toggleable (4 enabled day buttons), the rest are disabled
    expect(dayButtons(content)).toHaveLength(4);
    expect(richTexts(content).join(' ')).toContain('Selected: 4/4');

    const reloaded = DraftService.getDraft(session.draftId, session.authorId);
    expect(reloaded.selectedDates).toHaveLength(4);
  });

  it('disables further slot buttons and shows the n/max counter once the per-day limit is reached', () => {
    const flow = new FlowManager();
    const userId = 882;
    flow.start(String(userId), null, fromUser(userId), 'Limits test');
    const session = flow.sessions.get('882:882');
    const days0 = flow.onCallback(String(userId), userId, 'month:+1').content;

    const day = dayButtons(days0)[0];
    const selected = flow.onCallback(String(userId), userId, day.callback_data);
    const dayDate = decodeCallback(day.callback_data).date;

    let times = flow.onCallback(String(userId), userId, okFor(selected.content, 'days')).content;
    const presses = slotButtons(times)
      .slice(0, 6)
      .map((b) => b.callback_data);
    for (const data of presses) {
      times = flow.onCallback(String(userId), userId, data).content;
    }

    // selected slots stay toggleable (6 enabled slot buttons), the rest are disabled
    expect(slotButtons(times)).toHaveLength(6);
    expect(richTexts(times).join(' ')).toContain('Selected: 6/6');

    const reloaded = DraftService.getDraft(session.draftId, session.authorId);
    expect(countUnits(reloaded.timeSlots.filter((s) => s.date === dayDate))).toBe(6);
  });
});
