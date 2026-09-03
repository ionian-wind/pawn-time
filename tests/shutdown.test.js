import { jest } from '@jest/globals';

describe('registerShutdown', () => {
  let exitSpy;

  const freshModule = async () => {
    jest.resetModules();
    return import('../src/util/shutdown.js');
  };

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('runs cleanup and exits 0 on SIGINT', async () => {
    const { registerShutdown } = await freshModule();
    const cleanup = jest.fn();
    registerShutdown(cleanup);

    process.emit('SIGINT');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runs cleanup and exits 0 on SIGTERM', async () => {
    const { registerShutdown } = await freshModule();
    const cleanup = jest.fn();
    registerShutdown(cleanup);

    process.emit('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('reports and cleanly exits 1 on unhandledRejection', async () => {
    const { registerShutdown } = await freshModule();
    const cleanup = jest.fn();
    const report = jest.fn();
    registerShutdown(cleanup, report);

    process.emit('unhandledRejection', new Error('boom'));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe('unhandledRejection');
    expect(report.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(report.mock.calls[0][1].message).toBe('boom');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('normalizes a non-Error rejection reason', async () => {
    const { registerShutdown } = await freshModule();
    const report = jest.fn();
    registerShutdown(() => {}, report);

    process.emit('unhandledRejection', 'string reason');

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(report.mock.calls[0][1].message).toBe('string reason');
  });

  it('reports and cleanly exits 1 on uncaughtException', async () => {
    const { registerShutdown } = await freshModule();
    const cleanup = jest.fn();
    const report = jest.fn();
    registerShutdown(cleanup, report);

    process.emit('uncaughtException', new Error('fatal'));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe('uncaughtException');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('runs cleanup exactly once when several events arrive together', async () => {
    const { registerShutdown } = await freshModule();
    const cleanup = jest.fn();
    registerShutdown(cleanup);

    process.emit('unhandledRejection', new Error('a'));
    process.emit('uncaughtException', new Error('b'));
    process.emit('SIGINT');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('surfaces a cleanup failure but still exits', async () => {
    const { registerShutdown } = await freshModule();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    registerShutdown(() => {
      throw new Error('cleanup broken');
    });

    process.emit('SIGINT');
    consoleError.mockRestore();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
