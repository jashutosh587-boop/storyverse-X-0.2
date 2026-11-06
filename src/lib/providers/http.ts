/**
 * A small, polite JSON-over-HTTP client for metadata providers.
 *
 *  - serializes requests and keeps a minimum gap between them (rate limiting)
 *  - retries 408/425/429/5xx and network errors with exponential backoff,
 *    honouring Retry-After
 *  - never retries other 4xx responses: those are caller errors
 *
 * `fetch`, `sleep`, `now` and `random` are injectable so the behaviour can be
 * tested without real time or a real network.
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(`${message} (${url})`);
    this.name = 'ProviderHttpError';
  }
}

export interface HttpClientOptions {
  userAgent: string;
  headers?: Record<string, string>;
  /** Minimum milliseconds between the start of two requests. */
  minIntervalMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface HttpClient {
  getJson(url: string): Promise<unknown>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Retry-After as milliseconds: either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    userAgent,
    headers = {},
    minIntervalMs = 0,
    maxRetries = 4,
    baseDelayMs = 1000,
    timeoutMs = 20_000,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    random = Math.random,
  } = options;

  let nextSlot = 0;
  let queue: Promise<void> = Promise.resolve();

  // Callers take their slot in order, so concurrent requests cannot burst past the limit.
  const takeSlot = (): Promise<void> => {
    const turn = queue.then(async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      nextSlot = now() + minIntervalMs;
    });
    queue = turn.catch(() => undefined);
    return turn;
  };

  const backoff = (attempt: number) => baseDelayMs * 2 ** attempt + Math.floor(random() * 250);

  async function getJson(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      await takeSlot();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': userAgent, ...headers },
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ProviderHttpError(0, url, `Network error: ${(err as Error).message}`);
      }
      clearTimeout(timer);

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new ProviderHttpError(res.status, url, 'Response was not valid JSON');
        }
      }

      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        const wait = parseRetryAfter(res.headers.get('retry-after'), now()) ?? backoff(attempt);
        await sleep(wait);
        continue;
      }
      throw new ProviderHttpError(res.status, url, `HTTP ${res.status}`);
    }
  }

  return { getJson };
}
