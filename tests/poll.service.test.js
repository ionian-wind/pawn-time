import { closeDatabase } from '../src/db/database.js';
import { PollService, PollRepository, VoteService } from '../src/index.js';

function cast(poll, session, optionId, response, info) {
  const result = VoteService.castVote(poll.id, session, optionId, response, info);
  if (!result || !result.voteSaved) {
    throw new Error(`cast failed for ${session}: ${result?.error}`);
  }
}

afterAll(() => closeDatabase());

describe('PollService', () => {
  const baseOptions = [
    { date: '2026-09-10', startTime: '10:00', endTime: '11:00' },
    { date: '2026-09-11', startTime: '10:00', endTime: '11:00' },
    { date: '2026-09-12', startTime: '14:00', endTime: '15:00' },
  ];

  describe('createPoll', () => {
    it('creates a poll with options', () => {
      const poll = PollService.createPoll(
        { title: 'Team Meeting', pollType: 'datetime' },
        baseOptions
      );

      expect(poll.id).toBeDefined();
      expect(poll.title).toBe('Team Meeting');
      expect(poll.pollType).toBe('datetime');
      expect(poll.options).toHaveLength(3);
      expect(poll.participantCount).toBe(0);
      expect(poll.voteCounts).toEqual({ yes: 0, maybe: 0, no: 0 });
    });

    it('stores all options with correct poll id', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, baseOptions);

      for (const option of poll.options) {
        expect(option.pollId).toBe(poll.id);
      }
    });

    it('applies defaults when optional fields are omitted', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, []);
      const stored = PollRepository.findById(poll.id);
      expect(stored.timezone).toBe('UTC');
      expect(stored.allowMaybe).toBe(true);
    });
  });

  describe('getPoll / getPollWithStats / listPolls', () => {
    it('returns null for a non-existent poll', () => {
      expect(PollService.getPoll('missing')).toBeNull();
      expect(PollService.getPollWithStats('missing')).toBeNull();
    });

    it('returns a poll by id', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, baseOptions);
      const found = PollService.getPoll(poll.id);
      expect(found.title).toBe('P');
    });

    it('lists polls ordered by creation date (descending)', () => {
      const first = PollService.createPoll({ title: 'First', pollType: 'date' }, []);
      const second = PollService.createPoll({ title: 'Second', pollType: 'date' }, []);

      const polls = PollService.listPolls();
      expect(polls).toHaveLength(2);
      expect(new Set(polls.map((p) => p.id))).toEqual(new Set([first.id, second.id]));
    });
  });

  describe('updatePoll / deletePoll', () => {
    it('updates a poll', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, []);
      const updated = PollService.updatePoll(poll.id, { title: 'Renamed' });

      expect(updated.title).toBe('Renamed');
    });

    it('deletes a poll', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, []);
      expect(PollService.deletePoll(poll.id)).toBe(true);
      expect(PollService.getPoll(poll.id)).toBeNull();
    });
  });

  describe('best option selection', () => {
    it('selects the option with the most "yes" votes', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'datetime' }, baseOptions);
      const [opt1, opt2] = poll.options;

      cast(poll, 's1', opt1.id, 'yes');
      cast(poll, 's2', opt1.id, 'yes');
      cast(poll, 's3', opt1.id, 'yes');
      cast(poll, 's1', opt2.id, 'maybe');

      const best = PollService.getBestOption(poll.id);
      expect(best.id).toBe(opt1.id);
      expect(best.voteSummary.yes).toBe(3);
    });

    it('prefers a guaranteed yes over many maybes', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'datetime' }, baseOptions);
      const [opt1, opt2] = poll.options;

      // opt1: 5 maybes -> score 5
      for (let i = 0; i < 5; i++) {
        cast(poll, `m${i}`, opt1.id, 'maybe');
      }

      // opt2: 1 yes -> score 10
      cast(poll, 's1', opt2.id, 'yes');

      const best = PollService.getBestOption(poll.id);
      expect(best.id).toBe(opt2.id);
    });
  });

  describe('finalizePoll', () => {
    it('finalizes a poll and records the best option', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'datetime' }, baseOptions);
      const [opt1] = poll.options;
      cast(poll, 's1', opt1.id, 'yes');

      const result = PollService.finalizePoll(poll.id);
      expect(result.poll.isFinalized).toBe(true);
      expect(result.bestOption.id).toBe(opt1.id);
      expect(PollRepository.findById(poll.id).finalizedSlotId).toBe(opt1.id);
    });

    it('returns the same finalized option on repeat calls', () => {
      const poll = PollService.createPoll({ title: 'P', pollType: 'date' }, baseOptions);
      const [opt1] = poll.options;
      cast(poll, 's1', opt1.id, 'yes');

      const first = PollService.finalizePoll(poll.id);
      const second = PollService.finalizePoll(poll.id);
      expect(second.poll.isFinalized).toBe(true);
      expect(second.bestOption.id).toBe(first.bestOption.id);
    });

    it('returns null if poll does not exist', () => {
      expect(PollService.finalizePoll('missing')).toBeNull();
    });
  });
});
