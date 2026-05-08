import { config } from '../config.js';

const DEFAULT_TIMEOUT_MS = 15_000;

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
