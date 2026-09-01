import { closeDatabase } from '../src/db/database.js';
import { createBot } from '../src/bot/index.js';
import { richButtons, richTexts } from '../src/bot/ui.js';

const okBody = (result) => JSON.stringify({ ok: true, result });

/**
 * Records every API call, mirroring Telegram's ephemeral bot messages: sends
 * that carry `ephemeral_message_parameters` are answered with an ephemeral
 * message id (like the real API).
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
    const isSend = method === 'sendMessage' || method === 'sendRichMessage';
    const result = isSend
      ? {
          message_id: 20_000 + log.length,
          ...(body.ephemeral_message_parameters
            ? { ephemeral_message_id: 30_000 + log.length }
            : {}),
          chat: { id: body.chat_id },
        }
      : true;
    return { status: 200, text: async () => okBody(result) };
  };
}

let updateSeq = 50_000;

/**
 * A `/new` command update sent from a group chat. `ephemeral` simulates the
 * author's command being ephemeral (is_ephemeral commands live in the group,
 * invisible to everyone else).
 * @param text
 * @param opts
 * @param opts.ephemeral
 * @param opts.chatId
 * @param opts.fromId
 */
function groupNew(text, { ephemeral = true, chatId = 999, fromId = 111 } = {}) {
  return {
    update_id: ++updateSeq,
    message: {
      message_id: 1,
      from: { id: fromId, is_bot: false, first_name: 'Alice', language_code: 'en' },
      chat: { id: chatId, type: 'group', title: 'Team' },
      date: 1_700_000_000,
      text,
      ...(ephemeral ? { ephemeral_message_id: 444 } : {}),
    },
  };
}

/**
 * A `/drafts` command update sent from a group chat.
 * @param opts
 */
function groupDrafts(opts) {
  return groupNew('/drafts', opts);
}

/**
 * A callback update on the ephemeral draft form in the group.
 * @param data
 * @param opts
 * @param opts.chatId
 * @param opts.fromId
 */
function ephemeralCallback(data, { chatId = 999, fromId = 111 } = {}) {
  return {
    update_id: ++updateSeq,
    callback_query: {
      id: `e${updateSeq}`,
      from: { id: fromId, is_bot: false, first_name: 'Alice' },
      chat_instance: 'ci',
      data,
      message: {
        message_id: 5000,
        ephemeral_message_id: 3000,
        receiver_user: { id: fromId, is_bot: false, first_name: 'Alice' },
        chat: { id: chatId, type: 'group', title: 'Team' },
        date: 1_700_000_000,
      },
    },
  };
}

/**
 * @param log
 * @param method
 */
function lastCall(log, method) {
  return [...log].reverse().find((r) => r.method === method);
}

afterAll(() => closeDatabase());

describe('ephemeral draft flow in a group', () => {
  it('starts the /new builder as an ephemeral message visible only to the author', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Team sync'));

    const send = lastCall(log, 'sendRichMessage');
    expect(send).toBeTruthy();
    expect(send.body.ephemeral_message_parameters).toEqual({ receiver_user_id: 111 });
    expect(send.body.reply_parameters).toEqual({ ephemeral_message_id: 444 });
    expect(send.body.rich_message).toBeTruthy();
    expect(richTexts({ rich_message: send.body.rich_message }).join(' ')).toContain('Team sync');
  });

  it('keeps editing the same ephemeral message as the flow advances', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Team sync'));

    const days = richButtons({
      rich_message: lastCall(log, 'sendRichMessage').body.rich_message,
    });
    const dayCell = days.find((b) => String(b.callback_data).startsWith('day:'));

    await bot.handleUpdate(ephemeralCallback(dayCell.callback_data));

    const edit = lastCall(log, 'editEphemeralMessageText');
    expect(edit).toBeTruthy();
    expect(edit.body.rich_message).toBeTruthy();
    expect(edit.body.chat_id).toBe('999');
    expect(edit.body.receiver_user_id).toBe('111');
    expect(edit.body.ephemeral_message_id).toBe('30001');
    // a regular editMessageText must never touch an ephemeral form
    expect(log.filter((r) => r.method === 'editMessageText')).toHaveLength(0);
  });

  it('publishes the poll publicly and deletes the ephemeral form', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Team sync'));

    // pick two days, move to times, pick slots on each, then OK to publish
    const dates = richButtons({
      rich_message: lastCall(log, 'sendRichMessage').body.rich_message,
    })
      .filter((b) => String(b.callback_data).startsWith('day:'))
      .slice(0, 2)
      .map((b) => b.callback_data);

    for (const date of dates) {
      await bot.handleUpdate(ephemeralCallback(date));
    }

    const lastEdit = () =>
      richButtons({ rich_message: lastCall(log, 'editEphemeralMessageText').body.rich_message });

    await bot.handleUpdate(ephemeralCallback('ok:days'));
    await bot.handleUpdate(ephemeralCallback('ok:times'));

    const slot = lastEdit().find((b) => String(b.callback_data).startsWith('slot:'));
    await bot.handleUpdate(ephemeralCallback(slot.callback_data));
    await bot.handleUpdate(ephemeralCallback('ok:times'));

    // the published poll is a normal, visible message in the group
    const published = lastCall(log, 'sendRichMessage');
    expect(published).toBeTruthy();
    expect(published.body.ephemeral_message_parameters).toBeUndefined();
    expect(published.body.chat_id).toBe('999');
    expect(richTexts({ rich_message: published.body.rich_message }).join(' ')).toContain(
      'Team sync'
    );

    // the ephemeral draft form is gone afterwards
    const removed = lastCall(log, 'deleteEphemeralMessage');
    expect(removed).toBeTruthy();
    expect(removed.body.chat_id).toBe('999');
    expect(removed.body.receiver_user_id).toBe('111');
    expect(removed.body.ephemeral_message_id).toBe('30001');
  });

  it('replies with an author-only ephemeral usage hint when /new has no title', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new'));

    const send = lastCall(log, 'sendMessage');
    expect(send).toBeTruthy();
    expect(send.body.ephemeral_message_parameters).toEqual({ receiver_user_id: 111 });
    expect(send.body.reply_parameters).toEqual({ ephemeral_message_id: 444 });
    expect(send.body.rich_message).toBeUndefined();
    expect(send.body.text).toContain('Usage: /new');
  });

  it('lists /drafts as an ephemeral message and re-renders it in place', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Draft one'));
    await bot.handleUpdate(groupDrafts());

    const drafts = lastCall(log, 'sendRichMessage');
    expect(drafts.body.ephemeral_message_parameters).toEqual({ receiver_user_id: 111 });
    const texts = richTexts({ rich_message: drafts.body.rich_message }).join(' ');
    expect(texts).toContain('Your drafts');
    expect(texts).toContain('Draft one');

    const delAll = richButtons({ rich_message: drafts.body.rich_message }).find(
      (b) => String(b.callback_data) === 'delall:'
    );
    await bot.handleUpdate(ephemeralCallback(String(delAll.callback_data)));

    const edit = lastCall(log, 'editEphemeralMessageText');
    expect(edit).toBeTruthy();
    expect(edit.body.ephemeral_message_id).toBe('3000');
    expect(richTexts({ rich_message: edit.body.rich_message }).join(' ')).toContain(
      'You have no drafts yet.'
    );
  });

  it('falls back to the DM builder when the command is not ephemeral', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Team sync', { ephemeral: false }));

    // builder goes to the author's DM, not the group, and is not ephemeral
    const send = lastCall(log, 'sendRichMessage');
    expect(send).toBeTruthy();
    expect(send.body.chat_id).toBe('111');
    expect(send.body.ephemeral_message_parameters).toBeUndefined();
  });

  it('falls back to the DM usage hint when the command is not ephemeral', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new', { ephemeral: false }));

    const send = lastCall(log, 'sendMessage');
    expect(send).toBeTruthy();
    expect(send.body.chat_id).toBe('111');
    expect(send.body.ephemeral_message_parameters).toBeUndefined();
    expect(send.body.text).toContain('Usage: /new');
  });
});

describe('ephemeral remove', () => {
  it('confirms removal in place of the ephemeral draft form', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(groupNew('/new Team sync'));
    await bot.handleUpdate(ephemeralCallback('remove:'));

    const edit = lastCall(log, 'editEphemeralMessageText');
    expect(edit).toBeTruthy();
    expect(edit.body.ephemeral_message_id).toBe('3000');
    expect(edit.body.receiver_user_id).toBe('111');
    expect(edit.body.text).toContain('Draft removed.');
    expect(edit.body.rich_message).toBeUndefined();
  });
});
