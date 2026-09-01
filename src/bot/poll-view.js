import { PollOptionRepository } from '../domains/poll/poll-option.repository.js';
import { VoteService } from '../domains/vote/vote.service.js';

/**
 * Assembles the rendering model for a poll as seen by a single voter. Options
 * are grouped into rows: within each date, consecutive 30-minute slots are
 * merged into a single availability range (e.g. 09:00-09:30 + 09:30-10:00
 * becomes "09:00-10:00"), and each row carries the summed vote counts plus the
 * voter's own (uniform) response, if they have voted on the whole row.
 * @param {import('../domains/poll/poll.entity.js').PollWithStats} poll
 * @param {string} sessionId - the voter's session id (e.g. Telegram user id)
 * @returns {{
 *   poll: import('../domains/poll/poll.entity.js').PollWithStats,
 *   rows: Array<{
 *     date: string,
 *     start: string | null,
 *     end: string | null,
 *     ids: Array<string>,
 *     counts: { yes: number, maybe: number, no: number }, - distinct participants per response
 *     mine: import('../domains/vote/vote.entity.js').VoteResponse | undefined,
 *     index: number
 *   }>,
 *   voted: boolean, - whether the viewer has cast any vote in this poll
 *   participantCount: number
 * }}
 */
export function buildPollView(poll, sessionId) {
  const myVotes = VoteService.getParticipantVotes(poll.id, sessionId) ?? {};

  const byDate = new Map();
  for (const option of poll.options) {
    if (!byDate.has(option.date)) byDate.set(option.date, []);
    byDate.get(option.date).push(option);
  }

  /** @type {ReturnType<buildPollView>['rows']} */
  const rows = [];
  let index = 0;

  for (const date of [...byDate.keys()].sort()) {
    const options = byDate
      .get(date)
      .slice()
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    let run = [];
    const flush = () => {
      if (run.length === 0) return;
      const ids = run.map((o) => o.id);
      // participant-level totals: one voter counts once per response even when
      // the row spans several consecutive slots
      const voted = new Set();
      const maybe = new Set();
      const rejected = new Set();
      for (const option of run) {
        const votes = PollOptionRepository.getWithVotes(option.id)?.votes ?? [];
        for (const vote of votes) {
          if (vote.response === 'yes') voted.add(vote.participantId);
          else if (vote.response === 'maybe') maybe.add(vote.participantId);
          else if (vote.response === 'no') rejected.add(vote.participantId);
        }
      }
      rows.push({
        date,
        start: run[0].startTime ?? null,
        end: run[run.length - 1].endTime ?? null,
        ids,
        counts: { yes: voted.size, maybe: maybe.size, no: rejected.size },
        mine: mineFor(myVotes, ids),
        index: index++,
      });
      run = [];
    };

    for (const option of options) {
      const prev = run[run.length - 1];
      if (prev && option.startTime && prev.endTime && option.startTime === prev.endTime) {
        run.push(option);
      } else {
        flush();
        run = [option];
      }
    }
    flush();
  }

  return {
    poll,
    rows,
    voted: Object.keys(myVotes).length > 0,
    participantCount: poll.participantCount,
  };
}

/**
 * The voter's uniform response across every slot of a row, or undefined when
 * the voter has not voted on the entire row.
 * @param {Record<string, import('../domains/vote/vote.entity.js').VoteResponse>} myVotes
 * @param {Array<string>} ids
 * @returns {import('../domains/vote/vote.entity.js').VoteResponse | undefined}
 */
function mineFor(myVotes, ids) {
  const responses = ids.map((id) => myVotes[id]).filter((r) => r !== undefined);
  if (responses.length !== ids.length) return undefined;
  return responses.every((r) => r === responses[0]) ? responses[0] : undefined;
}
