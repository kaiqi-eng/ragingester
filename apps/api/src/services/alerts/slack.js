function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`slack request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function formatRunFailedText(event) {
  const run = event?.run || {};
  const card = event?.card || {};
  const context = event?.context || {};
  const error = event?.error || {};
  const timestamp = context.timestamp || new Date().toISOString();
  return [
    '*Ragingester Alert*',
    `Type: ${event?.type || 'run_failed'}`,
    `Run ID: ${run.id || 'unknown'}`,
    `Card ID: ${card.id || run.card_id || 'unknown'}`,
    `Owner ID: ${card.owner_id || run.owner_id || 'unknown'}`,
    `Source Type: ${card.source_type || 'unknown'}`,
    `Trigger Mode: ${context.triggerMode || run.trigger_mode || 'unknown'}`,
    `Attempts: ${context.attempts ?? run.attempts ?? 'unknown'}/${context.maxRetries ?? 'unknown'}`,
    `Error: ${error.message || run.error || 'unknown'}`,
    `Timestamp: ${timestamp}`
  ].join('\n');
}

function formatDailyFailureDigestText(event) {
  const failures = Array.isArray(event?.failures) ? event.failures : [];
  const day = event?.day || 'unknown-day';
  const lines = [
    '*Ragingester Daily Failure Digest*',
    `Day (UTC): ${day}`,
    `Total Failures: ${failures.length}`
  ];

  for (const failure of failures) {
    const run = failure?.run || {};
    const card = failure?.card || {};
    const context = failure?.context || {};
    const error = failure?.error || {};
    lines.push(
      `- run=${run.id || 'unknown'} card=${card.id || run.card_id || 'unknown'} source=${card.source_type || 'unknown'} trigger=${context.triggerMode || run.trigger_mode || 'unknown'} error="${error.message || run.error || 'unknown'}" at=${context.timestamp || 'unknown'}`
    );
  }

  return lines.join('\n');
}

function formatEventText(event) {
  if (event?.type === 'daily_failure_digest') {
    return formatDailyFailureDigestText(event);
  }
  return formatRunFailedText(event);
}

export async function sendViaWebhook({ webhookUrl, event, timeoutMs }) {
  const text = formatEventText(event);
  const response = await withTimeout(fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  }), timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`slack webhook failed: ${response.status} ${body}`.trim());
  }
}

export async function sendViaBot({ botToken, channelId, event, timeoutMs }) {
  const text = formatEventText(event);
  const response = await withTimeout(fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${botToken}`
    },
    body: JSON.stringify({
      channel: channelId,
      text
    })
  }), timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`slack bot api failed: ${response.status} ${body}`.trim());
  }

  const json = await response.json().catch(() => ({}));
  if (!json.ok) {
    throw new Error(`slack bot api failed: ${json.error || 'unknown error'}`);
  }
}
