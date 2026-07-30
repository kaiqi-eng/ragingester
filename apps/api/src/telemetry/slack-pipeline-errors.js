function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`slack request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ webhookUrl: string, text: string, blocks: object[], timeoutMs: number }} input
 */
export async function postPipelineErrorWebhook({ webhookUrl, text, blocks, timeoutMs }) {
  const response = await withTimeout(fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, blocks })
  }), timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`slack pipeline-error webhook failed: ${response.status} ${body}`.trim());
  }
}

/**
 * @param {{ botToken: string, channelId: string, text: string, blocks: object[], timeoutMs: number }} input
 */
export async function postPipelineErrorBot({ botToken, channelId, text, blocks, timeoutMs }) {
  const response = await withTimeout(fetch('https://slack.com/api/chat.postMessage', {
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

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`slack pipeline-error bot api failed: ${response.status} ${body}`.trim());
  }

  const json = await response.json().catch(() => ({}));
  if (!json.ok) {
    throw new Error(`slack pipeline-error bot api failed: ${json.error || 'unknown error'}`);
  }
}
