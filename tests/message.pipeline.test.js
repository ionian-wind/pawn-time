import { createBot } from '../src/bot/index.js';
import { getDatabase } from '../src/db/database.js';
import { InboxRepository, OutboxRepository } from '../src/domains/message/index.js';

let updateSeq = 50_000;

/**
 *
 */
function nextUpdateId() {
  return ++updateSeq;
}

/**
 *
 * @param text
 */
function textUpdate(text) {
  return {
    update_id: nextUpdateId(),
    message: {
      message_id: 1,
      from: { id: 111, is_bot: false, first_name: 'Alice', language_code: 'en' },
      chat: { id: 111, type: 'private', first_name: 'Alice' },
      date: 1_700_000_000,
      text,
    },
  };
}

/**
 *
 * @param body
 * @param status
 */
function fakeResponse(body, status = 200) {
  return { status, text: async () => JSON.stringify(body) };
}

/**
 *
 * @param log
 */
function makeFetch(log) {
  return async (url, init = {}) => {
    const params = new URLSearchParams(String(init.body ?? ''));
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
    return { status: 200, text: async () => JSON.stringify({ ok: true, result }) };
  };
}

/**
 *
 */
function outgoingRows() {
  return getDatabase().prepare('SELECT * FROM outgoing_messages ORDER BY rowid ASC').all();
}

/**
 *
 */
function incomingRows() {
  return getDatabase().prepare('SELECT * FROM incoming_messages ORDER BY rowid ASC').all();
}

describe('message pipeline', () => {
  it('journals a successful outgoing call and marks it sent', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.api.sendMessage({ chat_id: 111, text: 'hi' });

    const rows = outgoingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chat_id: '111',
      method: 'sendMessage',
      status: 'sent',
      attempts: 1,
      error: null,
    });
    expect(rows[0].sent_at).toBeTruthy();
    expect(JSON.parse(rows[0].payload)).toMatchObject({ chat_id: 111, text: 'hi' });
    expect(log.map((r) => r.method)).toEqual(['sendMessage']);
  });

  it('does not journal control-plane calls', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.api.getMe();
    await bot.api.setMyCommands({
      commands: [
        { command: 'new', description: 'x' },
        { command: 'drafts', description: 'y' },
      ],
    });

    expect(outgoingRows()).toHaveLength(0);
  });

  it('leaves a message pending on a network failure and flushes it later', async () => {
    const seq = { n: 0 };
    const bot = createBot('123:fake', {
      fetch: async () => {
        if (++seq.n <= 1) throw new Error('network down');
        const result = { message_id: 500, chat: { id: 111 } };
        return { status: 200, text: async () => JSON.stringify({ ok: true, result }) };
      },
      maxRetries: 0,
    });

    await expect(bot.api.sendMessage({ chat_id: 111, text: 'hi' })).rejects.toThrow(
      'Network request failed'
    );

    let rows = outgoingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(rows[0].error).toContain('Network request failed');
    expect(rows[0].sent_at).toBeNull();

    await bot.flushOutbox();
    rows = outgoingRows();
    expect(rows[0]).toMatchObject({ status: 'sent', attempts: 2, error: null });
    expect(rows[0].sent_at).toBeTruthy();
  });

  it('marks a message failed on permanent Telegram errors', async () => {
    const bot = createBot('123:fake', {
      fetch: async () =>
        fakeResponse({ ok: false, error_code: 400, description: 'Bad Request: text is empty' }),
      maxRetries: 0,
    });

    await expect(bot.api.sendMessage({ chat_id: 111, text: '' })).rejects.toThrow('400');

    const rows = outgoingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(rows[0].error).toContain('Bad Request: text is empty');
  });

  it('persists incoming updates and dedupes by update_id', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    const update = textUpdate('/new Team sync');
    await bot.handleUpdate(update);
    await bot.handleUpdate(update);

    const rows = incomingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].update_id).toBe(update.update_id);
    expect(rows[0].processed_at).toBeTruthy();
    expect(log.filter((r) => r.method === 'sendRichMessage')).toHaveLength(1);
  });

  it('replays unprocessed updates via replayInbox', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    const update = textUpdate('/new Team sync');
    InboxRepository.record(update.update_id, update);

    const count = await bot.replayInbox();

    expect(count).toBe(1);
    const rows = incomingRows();
    expect(rows.at(-1).update_id).toBe(update.update_id);
    expect(rows.at(-1).processed_at).toBeTruthy();
    expect(log.filter((r) => r.method === 'sendRichMessage')).toHaveLength(1);
  });

  it('flushes pre-existing pending outbox rows without re-journaling', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    OutboxRepository.record('111', 'sendMessage', { chat_id: 111, text: 'first' });
    OutboxRepository.record('111', 'sendMessage', { chat_id: 111, text: 'second' });

    const count = await bot.flushOutbox();

    expect(count).toBe(2);
    const rows = outgoingRows();
    expect(rows.map((r) => ({ text: JSON.parse(r.payload).text, status: r.status }))).toEqual([
      { text: 'first', status: 'sent' },
      { text: 'second', status: 'sent' },
    ]);
    expect(log.map((r) => r.method)).toEqual(['sendMessage', 'sendMessage']);
  });
});
