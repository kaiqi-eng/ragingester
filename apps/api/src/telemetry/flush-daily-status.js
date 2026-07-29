import { config } from '../config.js';
import { buildRssDailyStatusBlocks } from './block-kit.js';
import { buildRssDailyStatus, yesterdayUtcDate } from './build-daily-status.js';
import { postStatusBot, postStatusWebhook } from './slack-status.js';

const postedDates = new Set();

function canUseWebhook() {
  return Boolean(config.telemetryStatusSlackWebhookUrl);
}

function canUseBot() {
  return Boolean(config.slackBotToken && config.telemetryStatusSlackChannelId);
}

/**
 * @param {{ repository: object, now?: Date, forceDate?: string }} input
 * @returns {Promise<{ posted: boolean, date: string, skippedReason?: string, status?: object }>}
 */
export async function flushRssDailyStatus({
  repository,
  now = new Date(),
  forceDate
} = {}) {
  if (!config.telemetryDailyStatusEnabled) {
    return {
      posted: false,
      date: forceDate || yesterdayUtcDate(now),
      skippedReason: 'disabled'
    };
  }

  const date = forceDate || yesterdayUtcDate(now);
  const forcing = Boolean(forceDate);

  if (!forcing && postedDates.has(date)) {
    return { posted: false, date, skippedReason: 'already_posted' };
  }

  if (!canUseWebhook() && !canUseBot()) {
    // eslint-disable-next-line no-console
    console.warn('telemetry.rss_daily_status_skipped', {
      date,
      skippedReason: 'not_configured'
    });
    return { posted: false, date, skippedReason: 'not_configured' };
  }

  let status;
  try {
    status = await buildRssDailyStatus({ repository, date });
    const { blocks } = buildRssDailyStatusBlocks(status);
    await deliverStatus({ status, blocks });

    // eslint-disable-next-line no-console
    console.info('telemetry.rss_daily_status', {
      date: status.date,
      run_id: status.run_id,
      ingest: status.ingest,
      feeds_active: status.feeds_active,
      status
    });

    postedDates.add(date);
    return { posted: true, date, status };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('telemetry.rss_daily_status_failed', {
      date,
      error: error?.message || String(error)
    });
    return {
      posted: false,
      date,
      skippedReason: 'delivery_failed',
      status
    };
  }
}

/**
 * @param {{ status: object, blocks: object[] }} input
 */
async function deliverStatus({ status, blocks }) {
  const timeoutMs = config.alertsSlackTimeoutMs;
  const primary = canUseWebhook() ? 'webhook' : 'bot';
  const fallback = primary === 'webhook' ? 'bot' : 'webhook';

  try {
    await sendTransport(primary, { status, blocks, timeoutMs });
  } catch (primaryError) {
    if ((fallback === 'webhook' && !canUseWebhook()) || (fallback === 'bot' && !canUseBot())) {
      throw primaryError;
    }
    try {
      await sendTransport(fallback, { status, blocks, timeoutMs });
    } catch (fallbackError) {
      throw new Error(
        `status delivery failed primary=${primaryError?.message || primaryError}; fallback=${fallbackError?.message || fallbackError}`
      );
    }
  }
}

/**
 * @param {'webhook' | 'bot'} transport
 * @param {{ status: object, blocks: object[], timeoutMs: number }} input
 */
async function sendTransport(transport, { status, blocks, timeoutMs }) {
  if (transport === 'webhook') {
    if (!canUseWebhook()) throw new Error('telemetry status webhook not configured');
    await postStatusWebhook({
      webhookUrl: config.telemetryStatusSlackWebhookUrl,
      status,
      blocks,
      timeoutMs
    });
    return;
  }

  if (!canUseBot()) throw new Error('telemetry status bot not configured');
  await postStatusBot({
    botToken: config.slackBotToken,
    channelId: config.telemetryStatusSlackChannelId,
    status,
    blocks,
    timeoutMs
  });
}

export function _resetDailyStatusFlushStateForTests() {
  postedDates.clear();
}
