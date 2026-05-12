import { config } from '../../config.js';
import { sendViaBot, sendViaWebhook } from './slack.js';

const failuresByDay = new Map();

function canUseWebhook() {
  return Boolean(config.slackWebhookUrl);
}

function canUseBot() {
  return Boolean(config.slackBotToken && config.slackChannelId);
}

function resolvePlan() {
  const primary = config.alertsSlackPrimary === 'bot' ? 'bot' : 'webhook';
  const fallback = primary === 'webhook' ? 'bot' : 'webhook';
  return [primary, fallback];
}

async function sendWithTransport(transport, event) {
  if (transport === 'webhook') {
    if (!canUseWebhook()) throw new Error('slack webhook not configured');
    await sendViaWebhook({
      webhookUrl: config.slackWebhookUrl,
      event,
      timeoutMs: config.alertsSlackTimeoutMs
    });
    return;
  }

  if (!canUseBot()) throw new Error('slack bot transport not configured');
  await sendViaBot({
    botToken: config.slackBotToken,
    channelId: config.slackChannelId,
    event,
    timeoutMs: config.alertsSlackTimeoutMs
  });
}

async function deliver(event) {
  if (!config.alertsEnabled) return false;

  const [primary, fallback] = resolvePlan();
  try {
    await sendWithTransport(primary, event);
    return true;
  } catch (primaryError) {
    try {
      await sendWithTransport(fallback, event);
      return true;
    } catch (fallbackError) {
      // eslint-disable-next-line no-console
      console.warn('alert delivery failed', {
        primary,
        fallback,
        primaryError: primaryError?.message || String(primaryError),
        fallbackError: fallbackError?.message || String(fallbackError)
      });
      return false;
    }
  }
}

function toDayKey(timestamp) {
  const iso = new Date(timestamp || Date.now()).toISOString();
  return iso.slice(0, 10); // UTC day key
}

export function recordFailureAlert(event) {
  const day = toDayKey(event?.context?.timestamp);
  const list = failuresByDay.get(day) || [];
  list.push(event);
  failuresByDay.set(day, list);
}

export async function flushDailyFailureAlerts({ now = new Date() } = {}) {
  if (!config.alertsEnabled) return { flushedDays: 0, flushedFailures: 0 };

  const currentDay = toDayKey(now);
  const daysToFlush = [...failuresByDay.keys()].filter((day) => day < currentDay).sort();

  let flushedDays = 0;
  let flushedFailures = 0;
  for (const day of daysToFlush) {
    const failures = failuresByDay.get(day) || [];
    if (failures.length === 0) {
      failuresByDay.delete(day);
      continue;
    }

    const sent = await deliver({
      type: 'daily_failure_digest',
      day,
      failures
    });

    if (sent) {
      flushedDays += 1;
      flushedFailures += failures.length;
      failuresByDay.delete(day);
    }
  }

  return { flushedDays, flushedFailures };
}

export function _resetAlertsStateForTests() {
  failuresByDay.clear();
}

