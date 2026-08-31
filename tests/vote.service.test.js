import { closeDatabase } from '../src/db/database.js';
import {
  PollService,
  VoteService,
  ParticipantRepository,
  VoteRepository,
  UserRepository,
} from '../src/index.js';

function createPoll(extra = {}) {
  return PollService.createPoll({ title: 'P', pollType: 'datetime', ...extra }, [
    { date: '2026-09-10', startTime: '10:00', endTime: '11:00' },
    { date: '2026-09-11', startTime: '10:00', endTime: '11:00' },
  ]);
}

function participantForSession(pollId, sessionId) {
  const user = UserRepository.findBySessionId(sessionId);
  return user ? ParticipantRepository.findByPollAndUser(pollId, user.id) : null;
}

afterAll(() => closeDatabase());

describe('VoteService', () => {
  describe('castVote', () => {
    it('casts a vote and creates the participant', () => {
      const poll = createPoll();
      const [opt] = poll.options;

      const result = VoteService.castVote(poll.id, 'session-1', opt.id, 'yes', {
        name: 'Alice',
      });

      expect(result).toEqual({ voteSaved: true });
      const participant = participantForSession(poll.id, 'session-1');
      expect(participant).toBeTruthy();
      expect(VoteRepository.findByPollOptionAndParticipant(opt.id, participant.id)).toBeTruthy();
    });

    it('updates an existing vote on second cast', () => {
      const poll = createPoll();
      const [opt] = poll.options;

      VoteService.castVote(poll.id, 'session-1', opt.id, 'yes');
      const result = VoteService.castVote(poll.id, 'session-1', opt.id, 'no');

      expect(result.voteSaved).toBe(true);
      const participant = participantForSession(poll.id, 'session-1');
      const votes = VoteRepository.findByParticipant(participant.id);
      expect(votes).toHaveLength(1);
      expect(votes[0].response).toBe('no');
    });

    it('returns null for a non-existent poll', () => {
      const result = VoteService.castVote('missing', 's', 'opt', 'yes');
      expect(result).toBeNull();
    });

    it('rejects a vote for an option from a different poll', () => {
      const pollA = createPoll();
      const pollB = createPoll();

      const result = VoteService.castVote(pollA.id, 's', pollB.options[0].id, 'yes');
      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('Invalid poll option');
    });

    it('rejects maybe votes when allowMaybe is false', () => {
      const poll = createPoll({ allowMaybe: false });
      const [opt] = poll.options;

      const result = VoteService.castVote(poll.id, 's', opt.id, 'maybe');
      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('Maybe responses are not allowed');
    });

    it('requires a name when requireIdentification is true', () => {
      const poll = createPoll({ requireIdentification: true });
      const [opt] = poll.options;

      const result = VoteService.castVote(poll.id, 's', opt.id, 'yes');
      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('Name is required to vote');

      const ok = VoteService.castVote(poll.id, 's', opt.id, 'yes', { name: 'Bob' });
      expect(ok.voteSaved).toBe(true);
    });

    it('rejects votes when the participant limit is reached', () => {
      const poll = createPoll({ maxParticipants: 1 });
      const [opt] = poll.options;

      VoteService.castVote(poll.id, 's1', opt.id, 'yes');
      const result = VoteService.castVote(poll.id, 's2', opt.id, 'yes');

      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('Maximum participants reached');
    });

    it('rejects votes on a finalized poll', () => {
      const poll = createPoll();
      const [opt] = poll.options;
      VoteService.castVote(poll.id, 's1', opt.id, 'yes');
      PollService.finalizePoll(poll.id);

      const result = VoteService.castVote(poll.id, 's2', opt.id, 'yes');
      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('Cannot vote on this poll');
    });

    it('rejects votes after the poll expires', () => {
      const poll = createPoll({ expiresAt: new Date(Date.now() - 1000).toISOString() });
      const [opt] = poll.options;

      const result = VoteService.castVote(poll.id, 's', opt.id, 'yes');
      expect(result.voteSaved).toBe(false);
    });
  });

  describe('changeVote', () => {
    it('changes the response of an existing vote', () => {
      const poll = createPoll();
      const [opt] = poll.options;
      VoteService.castVote(poll.id, 's', opt.id, 'yes');

      const participant = participantForSession(poll.id, 's');
      const result = VoteService.changeVote(poll.id, participant.id, opt.id, 'maybe');

      expect(result).toEqual({ voteSaved: true });
      const vote = VoteRepository.findByPollOptionAndParticipant(opt.id, participant.id);
      expect(vote.response).toBe('maybe');
    });

    it('returns an error when no vote exists to change', () => {
      const poll = createPoll();
      const [opt] = poll.options;
      VoteService.castVote(poll.id, 's', opt.id, 'yes');
      const other = PollService.createPoll({ title: 'P2', pollType: 'datetime' }, [
        { date: '2026-09-11', startTime: '10:00', endTime: '11:00' },
      ]);
      const otherOpt = other.options[0];

      const participant = participantForSession(poll.id, 's');
      const result = VoteService.changeVote(poll.id, participant.id, otherOpt.id, 'yes');
      expect(result.voteSaved).toBe(false);
      expect(result.error).toBe('No existing vote to change');
    });
  });

  describe('getParticipantVotes / getParticipantId', () => {
    it('returns mapped votes for a session', () => {
      const poll = createPoll();
      const [opt1, opt2] = poll.options;
      VoteService.castVote(poll.id, 's', opt1.id, 'yes');
      VoteService.castVote(poll.id, 's', opt2.id, 'no');

      const votes = VoteService.getParticipantVotes(poll.id, 's');
      expect(votes[opt1.id]).toBe('yes');
      expect(votes[opt2.id]).toBe('no');
    });

    it('returns the participant id for a session', () => {
      const poll = createPoll();
      const [opt] = poll.options;
      VoteService.castVote(poll.id, 's', opt.id, 'yes');

      const id = VoteService.getParticipantId(poll.id, 's');
      expect(id).toBeTruthy();
      expect(VoteService.getParticipantId(poll.id, 'unknown')).toBeNull();
    });
  });
});
