/**
 * Registers SIGINT/SIGTERM handlers that run a cleanup routine before the
 * process exits cleanly. Idempotent per signal: each is bound once.
 * @param {() => void} cleanup
 */
export function registerShutdown(cleanup) {
  const handle = () => {
    cleanup();
    process.exit(0);
  };
  process.once('SIGINT', handle);
  process.once('SIGTERM', handle);
}
