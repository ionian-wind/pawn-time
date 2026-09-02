/**
 * Process-level lifecycle coordination. Every shutdown path funnels through a
 * single `shutdown(code)` routine that runs the registered cleanup exactly once
 * and then exits:
 *   - SIGINT / SIGTERM: graceful stop, exit code 0.
 *   - `unhandledRejection` / `uncaughtException`: report the cause, run the
 *     same cleanup, exit code 1.
 * Registering the fatal-error handlers also overrides Node's default handling
 * for those events (which would crash the process without running cleanup).
 */

/** @type {(() => void) | null} */
let cleanup = null;
/** @type {boolean} */
let exiting = false;

/**
 * Runs the registered cleanup once, then exits with `code`. Guarded so that
 * multiple signals/errors arriving together never run cleanup twice.
 * @param {number} code
 */
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  try {
    cleanup?.();
  } catch (err) {
    // Never mask the exit by throwing out of cleanup; surface it on stderr.
    console.error('shutdown cleanup failed', err);
  } finally {
    process.exit(code);
  }
}

/**
 * Normalizes an `unhandledRejection` reason (which may be a primitive or an
 * object, not just an Error) into an Error for reporting.
 * @param {unknown} reason
 * @returns {Error}
 */
function toError(reason) {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  try {
    return new Error(JSON.stringify(reason));
  } catch {
    return new Error(String(reason));
  }
}

/**
 * Registers all process shutdown paths, keyed on a single cleanup routine:
 *   - `SIGINT` / `SIGTERM` stop the process cleanly (exit 0).
 *   - `unhandledRejection` / `uncaughtException` are reported through `report`
 *     (e.g. the bot logger) and then stop via the same cleanup (exit 1).
 * Signal handlers are bound once per signal; each call additionally installs
 * the fatal-error listeners, so this should be called a single time at startup.
 * @param {() => void} cleanupFn - e.g. stop polling and close the database
 * @param {(kind: string, err: Error) => void} [report]
 */
export function registerShutdown(cleanupFn, report) {
  cleanup = cleanupFn;
  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));

  process.on('unhandledRejection', (reason) => {
    const err = toError(reason);
    report?.('unhandledRejection', err);
    shutdown(1);
  });
  process.on('uncaughtException', (err) => {
    report?.('uncaughtException', err);
    shutdown(1);
  });
}
