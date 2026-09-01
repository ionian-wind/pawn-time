import { jest } from '@jest/globals';
import { createBot } from '../src/bot/index.js';
import { logger, setLogLevel } from '../src/bot/logger.js';

/**
 *
 * @param body
 * @param status
 */
function fakeResponse(body, status = 200) {
  return { status, text: async () => JSON.stringify(body) };
}

const okOptions = {
  fetch: async () => fakeResponse({ ok: true, result: { ok: true } }),
  maxRetries: 0,
};

/**
 *
 */
function capture() {
  const logs = [];
  const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((...args) => {
    if (typeof args[0] === 'string') logs.push(args[0]);
    return true;
  });
  return { logs, writeSpy };
}

/**
 *
 * @param {...any} spies
 */
function restore(...spies) {
  spies.forEach((s) => s.mockRestore());
}

describe('logger module', () => {
  afterEach(() => setLogLevel('info'));

  it('emits a JSON line at the configured level', () => {
    const { logs, writeSpy } = capture();
    logger.info('hello', { n: 1 });
    logger.error('boom', { code: 'E' });
    expect(logs).toHaveLength(2);
    expect(JSON.parse(logs[0])).toMatchObject({ level: 'info', msg: 'hello', n: 1 });
    expect(JSON.parse(logs[1])).toMatchObject({ level: 'error', msg: 'boom', code: 'E' });
    restore(writeSpy);
  });

  it('suppresses output below the threshold', () => {
    setLogLevel('silent');
    const { logs, writeSpy } = capture();
    logger.info('quiet');
    logger.error('also quiet');
    expect(logs).toHaveLength(0);
    restore(writeSpy);
  });
});

describe('bot logging', () => {
  afterEach(() => {
    setLogLevel('info');
    jest.restoreAllMocks();
  });

  it('logs every Telegram API call and its response', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, writeSpy } = capture();

    await bot.api.getMe();

    const apiLines = logs
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    expect(apiLines).toEqual(
      expect.arrayContaining([expect.objectContaining({ msg: 'telegram api', method: 'getMe' })])
    );
    restore(writeSpy);
  });

  it('logs incoming messages with sender and text', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, writeSpy } = capture();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 111, is_bot: false, first_name: 'Alice', language_code: 'en' },
        chat: { id: 111, type: 'private', first_name: 'Alice' },
        date: 1_700_000_000,
        text: 'hello',
      },
    });

    const lines = logs.join('\n');
    expect(lines).toContain('"msg":"incoming message"');
    expect(lines).toContain('"chatId":111');
    expect(lines).toContain('"text":"hello"');
    restore(writeSpy);
  });

  it('logs callback queries', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, writeSpy } = capture();

    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'q1',
        from: { id: 111, is_bot: false, first_name: 'Alice' },
        chat_instance: 'ci',
        data: 'day:2026-09-01',
      },
    });

    const lines = logs.join('\n');
    expect(lines).toContain('"msg":"incoming callback_query"');
    expect(lines).toContain('"data":"day:2026-09-01"');
    restore(writeSpy);
  });
});
