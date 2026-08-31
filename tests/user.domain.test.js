import { closeDatabase } from '../src/db/database.js';
import { PollService, VoteService, ParticipantRepository, UserRepository } from '../src/index.js';

function createPoll(extra = {}) {
  return PollService.createPoll({ title: 'P', pollType: 'datetime', ...extra }, [
    { date: '2026-09-10', startTime: '10:00', endTime: '11:00' },
  ]);
}

function participantForSession(pollId, sessionId) {
  const user = UserRepository.findBySessionId(sessionId);
  return user ? ParticipantRepository.findByPollAndUser(pollId, user.id) : null;
}

afterAll(() => closeDatabase());

describe('User domain', () => {
  it('stores identifying info on users, not participants', () => {
    const poll = createPoll();
    const [opt] = poll.options;

    const result = VoteService.castVote(poll.id, 's1', opt.id, 'yes', {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(result).toEqual({ voteSaved: true });

    const participant = participantForSession(poll.id, 's1');
    expect(participant).toBeTruthy();
    expect(participant.userId).toBeTruthy();

    const participantRow = participant;
    expect('name' in participantRow).toBe(false);
    expect('email' in participantRow).toBe(false);

    const user = UserRepository.findById(participant.userId);
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
  });

  it('creates a single user shared across polls for the same session', () => {
    const pollA = createPoll();
    const pollB = createPoll();
    const [optA] = pollA.options;
    const [optB] = pollB.options;

    VoteService.castVote(pollA.id, 'sA', optA.id, 'yes', {
      name: 'Alice',
      email: 'alice@example.com',
    });
    VoteService.castVote(pollB.id, 'sA', optB.id, 'yes');

    const participantA = participantForSession(pollA.id, 'sA');
    const participantB = participantForSession(pollB.id, 'sA');
    expect(participantA.userId).toBe(participantB.userId);
    expect(UserRepository.findByEmail('alice@example.com')).not.toBeNull();
  });

  it('dedupes the same person across different sessions via email', () => {
    const pollA = createPoll();
    const pollB = createPoll();
    const [optA] = pollA.options;
    const [optB] = pollB.options;

    VoteService.castVote(pollA.id, 'laptop-session', optA.id, 'yes', {
      name: 'Alice',
      email: 'alice@example.com',
    });
    VoteService.castVote(pollB.id, 'phone-session', optB.id, 'yes', {
      name: 'Alice',
      email: 'alice@example.com',
    });

    const userA = UserRepository.findBySessionId('laptop-session');
    const userB = UserRepository.findBySessionId('phone-session');
    expect(userA.id).toBe(userB.id);

    const sessions = UserRepository.findSessionsByUser(userA.id);
    expect(sessions.map((s) => s.sessionId)).toEqual(
      expect.arrayContaining(['laptop-session', 'phone-session'])
    );
  });

  it('creates a user account on demand for anonymous voters', () => {
    const poll = createPoll();
    const [opt] = poll.options;

    const result = VoteService.castVote(poll.id, 'sAnon', opt.id, 'yes');
    expect(result).toEqual({ voteSaved: true });

    const participant = ParticipantRepository.findByPollAndUser(
      poll.id,
      UserRepository.findBySessionId('sAnon').id
    );
    expect(participant.userId).toBeTruthy();
    expect(participantForSession(poll.id, 'sAnon')).not.toBeNull();
    expect(UserRepository.findBySessionId('sAnon')).not.toBeNull();
  });
});
