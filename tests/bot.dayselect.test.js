import { createBot } from '../src/bot/index.js';
import { richButtons } from '../src/bot/ui.js';

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
        ? { message_id: 100 + log.length, chat: { id: body.chat_id } }
        : true;
    return { status: 200, text: async () => okBody(result) };
  };
}

let updateSeq = 10_000;

const update = {
  message: {
    message_id: 1,
    from: { id: 111, is_bot: false, first_name: 'Alice', language_code: 'en' },
    chat: { id: 111, type: 'private', first_name: 'Alice' },
    date: 1_700_000_000,
  },
};

/**
 *
 * @param text
 */
function withText(text) {
  return {
    ...update,
    update_id: ++updateSeq,
    message: { ...update.message, text },
  };
}

describe('day select rich message', () => {
  it('delivers the day select as a rich message via sendRichMessage', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(withText('/new Team sync'));

    const send = log.find((r) => r.method === 'sendRichMessage');
    expect(send).toBeTruthy();
    expect(send.body.rich_message).toBeTruthy();

    const dayButtons = richButtons(send.body).filter((btn) =>
      String(btn.callback_data).startsWith('day:'),
    );
    expect(dayButtons.length).toBeGreaterThan(0);
    expect(dayButtons[0].text.length).toBeGreaterThan(0);
  });

  it('replies with a usage message when /new has no title', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(withText('/new'));

    const send = log.find((r) => r.method === 'sendMessage');
    expect(send).toBeTruthy();
    expect(send.body.rich_message).toBeUndefined();
    expect(send.body.text).toContain('Usage: /new');
    expect(send.body.text).toContain('Team sync');
  });

  it('edits the day select in place after a day callback', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(withText('/new Team sync'));
    await bot.handleUpdate({
      update_id: ++updateSeq,
      callback_query: {
        id: 'c1',
        from: { id: 111, is_bot: false, first_name: 'Alice' },
        chat_instance: 'ci',
        data: 'day:2026-09-01',
        message: { message_id: 101, chat: { id: 111, type: 'private' }, date: 1_700_000_000 },
      },
    });

    const edit = log.find((r) => r.method === 'editMessageText');
    expect(edit).toBeTruthy();
    expect(edit.body.rich_message).toBeTruthy();
  });

  it('shows the Remove button on the days screen and deletes the draft in place', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(withText('/new Team sync'));

    const send = log.find((r) => r.method === 'sendRichMessage');
    const buttons = richButtons(send.body).map((b) => [b.text, String(b.callback_data)]);
    expect(buttons).toContainEqual(['Remove \u2715', 'remove:']);

    await bot.handleUpdate({
      update_id: ++updateSeq,
      callback_query: {
        id: 'c1',
        from: { id: 111, is_bot: false, first_name: 'Alice' },
        chat_instance: 'ci',
        data: 'remove:',
        message: { message_id: 101, chat: { id: 111, type: 'private' }, date: 1_700_000_000 },
      },
    });

    const edit = log.find((r) => r.method === 'editMessageText');
    expect(edit).toBeTruthy();
    expect(edit.body.text).toContain('Draft removed.');
    expect(edit.body.rich_message).toBeUndefined();
  });
});
