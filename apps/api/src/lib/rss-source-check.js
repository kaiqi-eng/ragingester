import { config } from '../config.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 5;

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function asUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function directFeedCheck(feedUrl) {
  const response = await fetchWithTimeout(feedUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`feed URL responded with status ${response.status}`);
  }
}

async function endpointFeedCheck(feedUrl, params = {}) {
  const apiKey = params.genie_rss_api_key || config.genieRssApiKey;
  if (!apiKey) {
    await directFeedCheck(feedUrl);
    return;
  }

  const baseUrl = trimTrailingSlash(params.genie_rss_base_url || config.genieRssBaseUrl);
  const response = await fetchWithTimeout(`${baseUrl}/api/rss/fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      url: feedUrl,
      since: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`source checker rejected feed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

export async function validateRssSourceBeforeCardCreation({ sourceInput, params = {} }) {
  const parsed = asUrl(sourceInput);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('RSS source input must be a valid HTTP(S) URL');
  }

  await endpointFeedCheck(parsed.toString(), params);
}

export async function validateRssSourcesBeforeCardCreation({ items, concurrency = DEFAULT_CONCURRENCY }) {
  const safeItems = Array.isArray(items) ? items : [];
  const normalizedConcurrency = Number.isInteger(concurrency) && concurrency > 0
    ? concurrency
    : DEFAULT_CONCURRENCY;

  const results = new Array(safeItems.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= safeItems.length) break;

      const item = safeItems[index];
      try {
        await validateRssSourceBeforeCardCreation({
          sourceInput: item.sourceInput,
          params: item.params
        });
        results[index] = { ok: true, meta: item.meta };
      } catch (error) {
        results[index] = {
          ok: false,
          meta: item.meta,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, Math.max(1, safeItems.length)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
