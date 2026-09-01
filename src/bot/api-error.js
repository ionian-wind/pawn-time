/**
 * Human-readable error text for a recorded API failure.
 * @param {*} err
 * @returns {string}
 */
export function describeApiError(err) {
  if (err?.description) return `${err.description} (${err?.errorCode ?? 'no code'})`;
  return err?.message ?? String(err);
}

/**
 * A request is retryable when it failed before reaching Telegram (no HTTP
 * status) or with a server-side status (5xx); permanent 4xx rejection is a
 * definite failure.
 * @param {*} err
 * @returns {boolean}
 */
export function isRetryableApiError(err) {
  const code = err?.errorCode ?? err?.response?.status;
  if (code == null) return true;
  return code >= 500;
}
