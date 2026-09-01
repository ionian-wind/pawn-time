import { createBot } from '../src/bot/index.js';
import { richTexts, richButtons } from '../src/bot/ui.js';
import { VoteService } from '../src/index.js';

const okBody = (result) => JSON.stringify({ ok: true, result });

/**
 *
 * @param log
 */
function makeFetch(log) {
  return async (url, init = {}) => {
    const params =
      init.body instanceof URLSearchParams
        ? init.body
        : new URLSearchParams(String(init.body ?? ''));
    const body = {};
    for (const [key, value] of params) {
      body[key] = value.startsWith('{') || value.startsWith('[') ? JSON.parse(value) : value;
    }
    const method = url.split('/').pop();
    log.push({ method, body });
    const result =
      method === 'sendMessage' || method === 'sendRichMessage'
        ? { message_id: 1000 + log.length, chat: { id: body.chat_id } }
        : true;
    return { status: 200, text: async () => okBody(result) };
  };
}

let updateSeq = 20_000;

/**
 *
 * @param userId
 * @param text
 */
function messageUpdate(userId, text) {
  return {
    update_id: ++updateSeq,
    message: {
      message_id: 1,
      from: { id: userId, is_bot: false, first_name: 'Alice' },
      chat: { id: userId, type: 'private' },
      date: 1_700_000_000,
      text,
    },
  };
}

/**
 *
 * @param userId
 * @param data
 * @param chatId
 */
function callbackUpdate(userId, data, chatId) {
  return {
    update_id: ++updateSeq,
    callback_query: {
      id: `q${userId}`,
      from: { id: userId, is_bot: false, first_name: 'Bob' },
      chat_instance: 'ci',
      data,
      message: { message_id: 1, chat: { id: chatId, type: 'private' }, date: 1_700_000_000 },
    },
  };
}

/**
 *
 */
function nextMonthFirstDay() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const first = new Date(year, month, 1);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 *
 * @param bot
 */
async function publishPoll(bot) {
  await bot.handleUpdate(messageUpdate(111, '/new Team sync'));
  const date = nextMonthFirstDay();
  await bot.handleUpdate(callbackUpdate(111, 'month:+1', 111));
  await bot.handleUpdate(callbackUpdate(111, `day:${date}`, 111));
  await bot.handleUpdate(callbackUpdate(111, 'ok:days', 111));
  await bot.handleUpdate(callbackUpdate(111, `slot:${date}:09:00`, 111));
  await bot.handleUpdate(callbackUpdate(111, `slot:${date}:09:30`, 111));
  await bot.handleUpdate(callbackUpdate(111, 'ok:times', 111));
  return date;
}

/**
 *
 * @param log
 * @param method
 */
function pollIdFromMessage(log, method) {
  const publish = [...log].reverse().find((r) => r.method === method);
  const blocks = publish.body.rich_message.blocks;
  const stage = blocks
    .filter((b) => b.type === 'buttons')
    .flatMap((b) => b.buttons)
    .find((btn) => String(btn.callback_data).startsWith('stage:'));
  return stage.callback_data.split(':')[1];
}

/**
 *
 * @param log
 * @param method
 */
function buttonTexts(log, method) {
  const edit = [...log].reverse().find((r) => r.method === method);
  if (!edit) return [];
  return edit.body.rich_message.blocks
    .filter((b) => b.type === 'buttons')
    .flatMap((b) => b.buttons)
    .map((b) => b.text);
}

/**
 *
 * @param log
 * @param method
 */
function messageTexts(log, method) {
  const entry = [...log].reverse().find((r) => r.method === method);
  if (!entry) return [];
  return richTexts(entry.body).join(' ');
}

/**
 *
 * @param log
 * @param method
 */
function stageButtonCount(log, method) {
  const edit = [...log].reverse().find((r) => r.method === method);
  if (!edit) return 0;
  return edit.body.rich_message.blocks
    .filter((b) => b.type === 'buttons')
    .flatMap((b) => b.buttons)
    .filter((b) => String(b.callback_data).startsWith('stage:')).length;
}

describe('poll voting via the bot', () => {
  it('publishes a poll with grouped rows and per-row vote/reject buttons', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);

    const pollId = pollIdFromMessage(log, 'sendRichMessage');
    expect(pollId).toBeTruthy();

    // two adjacent slots on one date merge into a single range row
    expect(messageTexts(log, 'sendRichMessage')).toContain('09:00\u201310:00');
    // no separate global Vote button anymore; vote buttons are per row
    expect(buttonTexts(log, 'sendRichMessage')).not.toContain('Vote \u2714');
    expect(stageButtonCount(log, 'sendRichMessage')).toBe(3);
  });

  it('removes the draft form message once the poll is published', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);

    const deletes = log.filter((r) => r.method === 'deleteMessage');
    expect(deletes).toHaveLength(1);
    // the draft form lives in the author's DM and carries its tracked message id
    expect(deletes[0].body).toMatchObject({ chat_id: String(111) });
    expect(Number(deletes[0].body.message_id)).toBeGreaterThan(1000);
  });

  it('stages a vote choice for a whole row and applies it only on confirm', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    // a different user (999) stages "yes" on the grouped row — nothing applied yet
    await bot.handleUpdate(callbackUpdate(999, `stage:${pollId}:0:y`, 111));
    const before = VoteService.getParticipantVotes(pollId, '999');
    expect(before && Object.values(before)).not.toContain('yes');
    expect(buttonTexts(log, 'editMessageText')).toContain('Confirm \u2713');

    await bot.handleUpdate(callbackUpdate(999, `vok:${pollId}`, 111));

    // both slots of the row were voted, and the buttons disappear for the voter
    const after = VoteService.getParticipantVotes(pollId, '999');
    expect(after && Object.values(after)).toEqual(['yes', 'yes']);
    expect(messageTexts(log, 'editMessageText')).toContain('\u27131');
    expect(stageButtonCount(log, 'editMessageText')).toBe(0);
  });

  it('marks a row as maybe and shows the maybe total after confirm', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    await bot.handleUpdate(callbackUpdate(666, `stage:${pollId}:0:m`, 111));
    await bot.handleUpdate(callbackUpdate(666, `vok:${pollId}`, 111));

    const after = VoteService.getParticipantVotes(pollId, '666');
    expect(after && Object.values(after)).toEqual(['maybe', 'maybe']);
    expect(messageTexts(log, 'editMessageText')).toContain('~1');
    expect(stageButtonCount(log, 'editMessageText')).toBe(0);
  });

  it('rejects a row and shows the rejected total after confirm', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    await bot.handleUpdate(callbackUpdate(777, `stage:${pollId}:0:n`, 111));
    await bot.handleUpdate(callbackUpdate(777, `vok:${pollId}`, 111));

    const after = VoteService.getParticipantVotes(pollId, '777');
    expect(after && Object.values(after)).toEqual(['no', 'no']);
    expect(messageTexts(log, 'editMessageText')).toContain('\u27171');
    expect(stageButtonCount(log, 'editMessageText')).toBe(0);
  });

  it('cancel discards staged votes without applying them', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    await bot.handleUpdate(callbackUpdate(777, `stage:${pollId}:0:y`, 111));
    await bot.handleUpdate(callbackUpdate(777, `vcancel:${pollId}`, 111));

    const after = VoteService.getParticipantVotes(pollId, '777');
    expect(after && Object.values(after)).not.toContain('yes');
  });

  it('staging the same response again removes it from the staged set', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await publishPoll(bot);
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    await bot.handleUpdate(callbackUpdate(555, `stage:${pollId}:0:y`, 111));
    await bot.handleUpdate(callbackUpdate(555, `stage:${pollId}:0:y`, 111));

    // staged set is now empty: confirm/cancel stay visible but disabled
    const panel = [...log].reverse().find((r) => r.method === 'editMessageText');
    const buttons = panel ? richButtons(panel.body) : [];
    const confirm = buttons.find((b) => b.text === 'Confirm \u2713');
    const cancel = buttons.find((b) => b.text === 'Cancel \u2717');
    expect(confirm).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(confirm.callback_data).toBeUndefined();
    expect(cancel.callback_data).toBeUndefined();

    // staged set is now empty, so confirm applies nothing
    await bot.handleUpdate(callbackUpdate(555, `vok:${pollId}`, 111));
    const after = VoteService.getParticipantVotes(pollId, '555');
    expect(after && Object.values(after)).not.toContain('yes');
  });

  it('disables every row once the viewer confirmed their votes', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(111, '/new Team sync'));
    const date = nextMonthFirstDay();
    await bot.handleUpdate(callbackUpdate(111, 'month:+1', 111));
    await bot.handleUpdate(callbackUpdate(111, `day:${date}`, 111));
    await bot.handleUpdate(callbackUpdate(111, 'ok:days', 111));
    // two non-adjacent slots -> two separate rows (09:00-09:30, 10:00-10:30)
    await bot.handleUpdate(callbackUpdate(111, `slot:${date}:09:00`, 111));
    await bot.handleUpdate(callbackUpdate(111, `slot:${date}:10:00`, 111));
    await bot.handleUpdate(callbackUpdate(111, 'ok:times', 111));
    const pollId = pollIdFromMessage(log, 'sendRichMessage');

    // two rows are live for an unvoted viewer
    expect(stageButtonCount(log, 'sendRichMessage')).toBe(6);

    // vote only the first row, then confirm
    await bot.handleUpdate(callbackUpdate(999, `stage:${pollId}:0:y`, 111));
    await bot.handleUpdate(callbackUpdate(999, `vok:${pollId}`, 111));

    // all rows are now totals-only: no stage buttons remain anywhere
    expect(stageButtonCount(log, 'editMessageText')).toBe(0);
    const texts = messageTexts(log, 'editMessageText');
    expect(texts).toContain('09:00\u201309:30');
    expect(texts).toContain('10:00\u201310:30');
  });
});
