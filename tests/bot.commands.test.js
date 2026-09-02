import { closeDatabase } from '../src/db/database.js';
import { createBot } from '../src/bot/index.js';
import { buildCommands, registerBotCommands } from '../src/bot/commands.js';

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
    log.push({ method: url.split('/').pop(), body });
    return { status: 200, text: async () => okBody(true) };
  };
}

afterAll(() => closeDatabase());

describe('bot commands menu', () => {
  it('builds slash commands with localized descriptions', () => {
    expect(buildCommands('en')).toEqual([
      { command: 'new', description: 'Create a new scheduling poll' },
      { command: 'drafts', description: 'List, edit or delete your drafts' },
    ]);

    const ru = buildCommands('ru');
    expect(ru.map((c) => c.command)).toEqual(['new', 'drafts']);
    expect(ru[0].description).toContain('опрос');
    expect(ru[1].description).toContain('черновики');
  });

  it('registers the default and Russian command menus via setMyCommands', async () => {
    const log = [];
    const bot = createBot('123:fake', { fetch: makeFetch(log), maxRetries: 0 });

    await registerBotCommands(bot);
    await registerBotCommands(bot, 'ru');

    const calls = log.filter((r) => r.method === 'setMyCommands');
    expect(calls).toHaveLength(2);

    expect(calls[0].body.language_code).toBeUndefined();
    expect(calls[0].body.commands.map((c) => c.command)).toEqual(['new', 'drafts']);

    expect(calls[1].body.language_code).toBe('ru');
    expect(calls[1].body.commands[0].description).toContain('опрос');
  });
});
