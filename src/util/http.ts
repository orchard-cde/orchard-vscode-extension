export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number, cause?: unknown) {
    super(`request timed out after ${timeoutMs} ms`, cause === undefined ? undefined : { cause });
    this.name = 'FetchTimeoutError';
  }
}

/** Aborts the request after `timeoutMs`; a timer-caused abort rejects with FetchTimeoutError. */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new FetchTimeoutError(timeoutMs, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
