import { generateId, closeDatabase } from '../src/db/database.js';
import {
  DraftService,
  DraftRepository,
  UserRepository,
  VoteService,
  ParticipantRepository,
} from '../src/index.js';

/**
 *
 * @param name
 */
function createUser(name = 'Alice') {
  return UserRepository.create({ name, email: `${name.toLowerCase()}@example.com` });
}

afterAll(() => closeDatabase());

describe('Draft domain', () => {
  it('creates a draft with defaults and encodes JSON columns', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id });
    expect(draft).not.toBeNull();
    expect(draft.title).toBeNull();
    expect(draft.pollType).toBe('datetime');
    expect(draft.selectedDates).toEqual([]);
    expect(draft.timeSlots).toEqual([]);

    const reloaded = DraftRepository.findById(draft.id);
    expect(reloaded.selectedDates).toEqual([]);
    expect(reloaded.timeSlots).toEqual([]);
  });

  it('sets a title and toggles days', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id });

    const titled = DraftService.setTitle(draft.id, author.id, '  Launch party  ');
    expect(titled.title).toBe('Launch party');

    DraftService.addDate(draft.id, author.id, '2026-09-01');
    DraftService.addDate(draft.id, author.id, '2026-09-03');
    const afterAdds = DraftRepository.findById(draft.id);
    expect(afterAdds.selectedDates).toEqual(['2026-09-01', '2026-09-03']);

    const afterToggle = DraftService.toggleDate(draft.id, author.id, '2026-09-01');
    expect(afterToggle.selectedDates).toEqual(['2026-09-03']);

    const afterReset = DraftService.resetDates(draft.id, author.id);
    expect(afterReset.selectedDates).toEqual([]);
  });

  it('toggles 30-minute slots per date, merging adjacent picks into intervals', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id });
    DraftService.addDate(draft.id, author.id, '2026-09-03');

    const daySlots = [
      { date: '2026-09-03', start: '10:00', end: '10:30' },
      { date: '2026-09-03', start: '10:30', end: '11:00' },
      { date: '2026-09-06', start: '09:00', end: '09:30' },
    ];
    for (const slot of daySlots) {
      DraftService.toggleTimeSlot(draft.id, author.id, slot);
    }

    const afterAdds = DraftRepository.findById(draft.id);
    // 10:00 + 10:30 merge into one interval; 09:00 on a different date stays separate
    expect(afterAdds.timeSlots).toHaveLength(2);
    expect(afterAdds.timeSlots).toEqual(
      expect.arrayContaining([
        { date: '2026-09-03', start: '10:00', end: '11:00' },
        { date: '2026-09-06', start: '09:00', end: '09:30' },
      ]),
    );

    DraftService.toggleTimeSlot(draft.id, author.id, daySlots[0]);
    const afterRemove = DraftRepository.findById(draft.id);
    // removing the first 30-min unit splits the interval back into a tail slot
    expect(afterRemove.timeSlots).toEqual(
      expect.arrayContaining([
        { date: '2026-09-03', start: '10:30', end: '11:00' },
        { date: '2026-09-06', start: '09:00', end: '09:30' },
      ]),
    );
  });

  it('is author-only: other users cannot read or modify a draft', () => {
    const author = createUser('Bob');
    const intruder = createUser('Eve');
    const draft = DraftService.createDraft({ authorUserId: author.id });

    expect(DraftService.getDraft(draft.id, intruder.id)).toBeNull();
    expect(DraftService.setTitle(draft.id, intruder.id, 'hacked')).toBeNull();
    expect(DraftService.deleteDraft(draft.id, intruder.id)).toBe(false);
    expect(DraftRepository.findById(draft.id)).not.toBeNull();
  });

  it('publishes a draft as a datetime poll with one option per slot', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id, chatId: '123' });
    DraftService.setTitle(draft.id, author.id, 'Team sync');
    DraftService.addDate(draft.id, author.id, '2026-09-10');
    DraftService.addDate(draft.id, author.id, '2026-09-11');
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-10',
      start: '10:00',
      end: '10:30',
    });
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-11',
      start: '11:00',
      end: '11:30',
    });

    const poll = DraftService.publishDraft(draft.id, author.id);
    expect(poll).not.toBeNull();
    expect(poll.title).toBe('Team sync');
    expect(poll.pollType).toBe('datetime');
    expect(poll.options).toHaveLength(2);
    expect(poll.options.map((o) => o.date).sort()).toEqual(['2026-09-10', '2026-09-11']);
    expect(poll.options.find((o) => o.date === '2026-09-10').startTime).toBe('10:00');
    expect(poll.options.find((o) => o.date === '2026-09-11').startTime).toBe('11:00');
  });

  it('publishes adjacent slots merged into a single interval option', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id, chatId: '123' });
    DraftService.setTitle(draft.id, author.id, 'Merged');
    DraftService.addDate(draft.id, author.id, '2026-09-20');
    const units = [
      { start: '09:00', end: '09:30' },
      { start: '09:30', end: '10:00' },
      { start: '10:00', end: '10:30' },
    ];
    for (const { start, end } of units) {
      DraftService.toggleTimeSlot(draft.id, author.id, {
        date: '2026-09-20',
        start,
        end,
      });
    }

    const poll = DraftService.publishDraft(draft.id, author.id);
    expect(poll.options).toHaveLength(1);
    expect(poll.options[0]).toMatchObject({
      date: '2026-09-20',
      startTime: '09:00',
      endTime: '10:30',
    });
  });

  it('refuses to publish without a title or slots', () => {
    const author = createUser();
    const noTitle = DraftService.createDraft({ authorUserId: author.id });
    DraftService.setTitle(noTitle.id, author.id, '');
    expect(DraftService.publishDraft(noTitle.id, author.id)).toBeNull();

    const noSlots = DraftService.createDraft({ authorUserId: author.id });
    DraftService.setTitle(noSlots.id, author.id, 'Only a title');
    expect(DraftService.publishDraft(noSlots.id, author.id)).toBeNull();
  });

  it('published poll is votable through the normal vote flow', () => {
    const author = createUser();
    const draft = DraftService.createDraft({ authorUserId: author.id });
    DraftService.setTitle(draft.id, author.id, 'Votable');
    DraftService.addDate(draft.id, author.id, '2026-09-12');
    DraftService.toggleTimeSlot(draft.id, author.id, {
      date: '2026-09-12',
      start: '14:00',
      end: '14:30',
    });
    const poll = DraftService.publishDraft(draft.id, author.id);

    const voter = createUser('Carol');
    const participant = ParticipantRepository.findByPollAndUser(poll.id, voter.id);
    expect(participant).toBeNull();

    const opt = poll.options[0];
    const result = VoteService.castVote(poll.id, generateId(), opt.id, 'yes');
    expect(result).toEqual({ voteSaved: true });
  });
});
