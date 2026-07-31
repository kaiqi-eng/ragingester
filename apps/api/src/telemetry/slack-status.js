import { STATUS_HEADER_BY_SYSTEM, TELEMETRY_SYSTEM } from './constants.js';

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`slack request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {import('./validate.js').DailyStatus} status
 * @returns {string}
 */
export function statusFallbackText(status) {
  const headerPrefix = STATUS_HEADER_BY_SYSTEM[status?.system] || STATUS_HEADER_BY_SYSTEM[TELEMETRY_SYSTEM];
  return `${headerPrefix}, ${status.date}`;
}

/**
 * @param {import('./validate.js').RssDailyStatus} status
 * @returns {string}
 */
export function statusJsonFenceText(status) {
  return `\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\``;
}

/**
 * @param {{ webhookUrl: string, status: import('./validate.js').RssDailyStatus, blocks: object[], timeoutMs: number }} input
 */
export async function postStatusWebhook({ webhookUrl, status, blocks, timeoutMs }) {
  const text = statusFallbackText(status);
  const cardResponse = await withTimeout(fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, blocks })
  }), timeoutMs);

  if (!cardResponse.ok) {
    const body = await cardResponse.text().catch(() => '');
    throw new Error(`slack status webhook failed: ${cardResponse.status} ${body}`.trim());
  }

  const jsonResponse = await withTimeout(fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: statusJsonFenceText(status) })
  }), timeoutMs);

  if (!jsonResponse.ok) {
    const body = await jsonResponse.text().catch(() => '');
    throw new Error(`slack status webhook json follow-up failed: ${jsonResponse.status} ${body}`.trim());
  }
}

/**
 * @param {{ botToken: string, channelId: string, status: import('./validate.js').RssDailyStatus, blocks: object[], timeoutMs: number }} input
 */
export async function postStatusBot({ botToken, channelId, status, blocks, timeoutMs }) {
  const text = statusFallbackText(status);
  const parentResponse = await withTimeout(fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${botToken}`
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      blocks
    })
  }), timeoutMs);

  if (!parentResponse.ok) {
    const body = await parentResponse.text().catch(() => '');
    throw new Error(`slack status bot api failed: ${parentResponse.status} ${body}`.trim());
  }

  const parentJson = await parentResponse.json().catch(() => ({}));
  if (!parentJson.ok) {
    throw new Error(`slack status bot api failed: ${parentJson.error || 'unknown error'}`);
  }

  const threadTs = parentJson.ts;
  if (!threadTs) {
    throw new Error('slack status bot api failed: missing ts for thread reply');
  }

  const threadResponse = await withTimeout(fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${botToken}`
    },
    body: JSON.stringify({
      channel: channelId,
      text: statusJsonFenceText(status),
      thread_ts: threadTs
    })
  }), timeoutMs);

  if (!threadResponse.ok) {
    const body = await threadResponse.text().catch(() => '');
    throw new Error(`slack status bot thread failed: ${threadResponse.status} ${body}`.trim());
  }

  const threadJson = await threadResponse.json().catch(() => ({}));
  if (!threadJson.ok) {
    throw new Error(`slack status bot thread failed: ${threadJson.error || 'unknown error'}`);
  }
}
