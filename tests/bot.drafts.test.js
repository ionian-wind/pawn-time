import { closeDatabase } from '../src/db/database.js';
import { createBot } from '../src/bot/index.js';
import { richButtons, richTexts } from '../src/bot/ui.js';
import { DraftService, UserRepository } from '../src/index.js';

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

let updateSeq = 30_000;

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
 * @param log
 */
function lastRichMessage(log) {
  return [...log].reverse().find((r) => r.method === 'sendRichMessage' && r.body.rich_message);
}

/**
 *
 * @param log
 */
function lastEdit(log) {
  return [...log].reverse().find((r) => r.method === 'editMessageText');
}

/**
 *
 * @param content
 */
function draftButtons(content) {
  return richButtons(content).filter((b) => {
    const data = String(b.callback_data ?? '');
    return data.startsWith('edit:') || data.startsWith('del:');
  });
}

/**
 *
 * @param sessionId
 */
function authorId(sessionId) {
  return UserRepository.findOrCreateBySession({ name: 'Alice' }, String(sessionId)).id;
}

afterAll(() => closeDatabase());

describe('/drafts command', () => {
  it('lists all of the user drafts in a rich message with Continue and Delete buttons', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(111, '/new Draft one'));
    await bot.handleUpdate(messageUpdate(111, '/new Draft two'));
    await bot.handleUpdate(messageUpdate(111, '/drafts'));

    const message = lastRichMessage(log);
    expect(message).toBeTruthy();
    expect(message.body.rich_message).toBeTruthy();

    const texts = richTexts({ rich_message: message.body.rich_message }).join(' ');
    expect(texts).toContain('Your drafts');
    expect(texts).toContain('Draft one');
    expect(texts).toContain('Draft two');

    const buttons = draftButtons({ rich_message: message.body.rich_message });
    expect(buttons.filter((b) => b.callback_data.startsWith('edit:'))).toHaveLength(2);
    expect(buttons.filter((b) => b.callback_data.startsWith('del:'))).toHaveLength(2);
  });

  it('shows a hint when the user has no drafts', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(222, '/drafts'));

    const message = lastRichMessage(log);
    const texts = richTexts({ rich_message: message.body.rich_message }).join(' ');
    expect(texts).toContain('You have no drafts yet.');
  });

  it('deletes a draft from the list and re-renders it in place', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(111, '/new Draft one'));
    await bot.handleUpdate(messageUpdate(111, '/drafts'));

    const messages = [...log].reverse().filter((r) => r.method === 'sendRichMessage');
    const list = messages[0];
    const delData = draftButtons({ rich_message: list.body.rich_message }).find((b) =>
      b.callback_data.startsWith('del:')
    ).callback_data;

    await bot.handleUpdate(callbackUpdate(111, delData, 111));

    const edited = lastEdit(log);
    expect(edited).toBeTruthy();
    const texts = richTexts({ rich_message: edited.body.rich_message }).join(' ');
    expect(texts).not.toContain('Draft one');

    expect(DraftService.listDrafts(authorId(111))).toHaveLength(0);
  });

  it('resumes the draft flow on Continue and keeps editing the same message', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(111, '/new Team sync'));
    await bot.handleUpdate(messageUpdate(111, '/drafts'));

    const messages = [...log].reverse().filter((r) => r.method === 'sendRichMessage');
    const list = messages[0];
    const editData = draftButtons({ rich_message: list.body.rich_message }).find((b) =>
      b.callback_data.startsWith('edit:')
    ).callback_data;

    await bot.handleUpdate(callbackUpdate(111, editData, 111));

    const days = lastEdit(log);
    expect(days).toBeTruthy();
    const dayCell = richButtons({ rich_message: days.body.rich_message }).find((b) =>
      String(b.callback_data).startsWith('day:')
    );
    expect(dayCell).toBeTruthy();

    // the resumed flow is live: toggling a day keeps editing the message
    await bot.handleUpdate(callbackUpdate(111, dayCell.callback_data, 111));
    expect(lastEdit(log)).toBeTruthy();

    const afterToggle = richTexts({ rich_message: lastEdit(log).body.rich_message }).join(' ');
    const draft = DraftService.listDrafts(authorId(111))[0];
    expect(draft.selectedDates).toHaveLength(1);
    expect(afterToggle).toContain('Selected: 1/4');
  });

  it('is author-only: another user cannot delete a draft', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await bot.handleUpdate(messageUpdate(111, '/new Team sync'));
    await bot.handleUpdate(messageUpdate(111, '/drafts'));

    const messages = [...log].reverse().filter((r) => r.method === 'sendRichMessage');
    const list = messages[0];
    const delData = draftButtons({ rich_message: list.body.rich_message }).find((b) =>
      b.callback_data.startsWith('del:')
    ).callback_data;

    await bot.handleUpdate(callbackUpdate(999, delData, 111));

    expect(DraftService.listDrafts(authorId(111))).toHaveLength(1);
  });
});
