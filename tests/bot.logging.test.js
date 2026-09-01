import { jest } from '@jest/globals';
import { createBot } from '../src/bot/index.js';
import { logger, setLogLevel } from '../src/bot/logger.js';

function fakeResponse(body, status = 200) {
  return { status, text: async () => JSON.stringify(body) };
}

const okOptions = {
  fetch: async () => fakeResponse({ ok: true, result: { ok: true } }),
  maxRetries: 0,
};

function capture() {
  const logs = [];
  const logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(['log', ...a]));
  const errSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((...a) => logs.push(['err', ...a]));
  return { logs, logSpy, errSpy };
}

function restore(...spies) {
  spies.forEach((s) => s.mockRestore());
}

describe('logger module', () => {
  afterEach(() => setLogLevel('info'));

  it('emits a JSON line at the configured level', () => {
    const { logs, logSpy, errSpy } = capture();
    logger.info('hello', { n: 1 });
    logger.error('boom', { code: 'E' });
    expect(logs.length).toBe(2);
    expect(JSON.parse(logs[0][1])).toMatchObject({ level: 'info', msg: 'hello', n: 1 });
    expect(JSON.parse(logs[1][1])).toMatchObject({ level: 'error', msg: 'boom', code: 'E' });
    restore(logSpy, errSpy);
  });

  it('suppresses output below the threshold', () => {
    setLogLevel('silent');
    const { logs, logSpy, errSpy } = capture();
    logger.info('quiet');
    logger.error('also quiet');
    expect(logs).toHaveLength(0);
    restore(logSpy, errSpy);
  });
});

describe('bot logging', () => {
  afterEach(() => {
    setLogLevel('info');
    jest.restoreAllMocks();
  });

  it('logs every Telegram API call and its response', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, logSpy, errSpy } = capture();

    await bot.api.getMe();

    const apiLines = logs
      .map((l) => l[1])
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
    restore(logSpy, errSpy);
  });

  it('logs incoming messages with sender and text', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, logSpy, errSpy } = capture();

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

    const lines = logs.map((l) => l[1]).join('\n');
    expect(lines).toContain('"msg":"incoming message"');
    expect(lines).toContain('"chatId":111');
    expect(lines).toContain('"text":"hello"');
    restore(logSpy, errSpy);
  });

  it('logs callback queries', async () => {
    const bot = createBot('123:fake', okOptions);
    const { logs, logSpy, errSpy } = capture();

    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'q1',
        from: { id: 111, is_bot: false, first_name: 'Alice' },
        chat_instance: 'ci',
        data: 'day:2026-09-01',
      },
    });

    const lines = logs.map((l) => l[1]).join('\n');
    expect(lines).toContain('"msg":"incoming callback_query"');
    expect(lines).toContain('"data":"day:2026-09-01"');
    restore(logSpy, errSpy);
  });
});
