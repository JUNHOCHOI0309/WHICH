const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 250;
const ATTEMPT_TIMEOUT_MS = 12_000;

// Only explicitly reviewed read endpoints may use this helper. Never retry
// mutations: a lost response does not mean a write failed to commit.
export async function fetchReadWithRetry(url: URL, init?: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    init?.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetch(url, { ...init, cache: "no-store", signal });
      if (attempt === 1 || !RETRYABLE_STATUS.has(response.status)) return response;
      // Release the failed response connection before the sole retry.
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (
        attempt === 1 ||
        init?.signal?.aborted ||
        (!(error instanceof TypeError) && !timeout.aborted)
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
