import { config } from '../config.js';
import { buildDailyStatusBlocks } from './block-kit.js';
import { buildDailyStatus, yesterdayUtcDate } from './build-daily-status.js';
import {
  TELEMETRY_SYSTEM,
  TELEMETRY_SYSTEMS,
  sourceTypeForSystem
} from './constants.js';
import { incrementTelemetryCounter } from './metrics.js';
import { postStatusBot, postStatusWebhook } from './slack-status.js';

/** In-process cache keyed by `${system}|${date}` (durable store is source of truth). */
const postedKeys = new Set();

function postedKey(system, date) {
  return `${system}|${date}`;
}

function canUseWebhook() {
  return Boolean(config.telemetryStatusSlackWebhookUrl);
}

function canUseBot() {
  return Boolean(config.slackBotToken && config.telemetryStatusSlackChannelId);
}

/**
 * Systems to flush when master daily-status flag is on.
 * @returns {string[]}
 */
export function enabledDailyStatusSystems() {
  if (!config.telemetryDailyStatusEnabled) return [];
  const systems = [TELEMETRY_SYSTEMS.RSS];
  if (config.telemetryStatusYoutubeEnabled) systems.push(TELEMETRY_SYSTEMS.YOUTUBE);
  if (config.telemetryStatusLinkedinEnabled) systems.push(TELEMETRY_SYSTEMS.LINKEDIN);
  return systems;
}

/**
 * @param {{ repository: object, now?: Date, forceDate?: string, system?: string }} input
 * @returns {Promise<{ posted: boolean, date: string, system: string, skippedReason?: string, status?: object }>}
 */
export async function flushDailyStatus({
  repository,
  now = new Date(),
  forceDate,
  system = TELEMETRY_SYSTEM
} = {}) {
  const date = forceDate || yesterdayUtcDate(now);
  const forcing = Boolean(forceDate);

  if (!config.telemetryDailyStatusEnabled) {
    return {
      posted: false,
      date,
      system,
      skippedReason: 'disabled'
    };
  }

  if (!forcing && system === TELEMETRY_SYSTEMS.YOUTUBE && !config.telemetryStatusYoutubeEnabled) {
    return { posted: false, date, system, skippedReason: 'system_disabled' };
  }
  if (!forcing && system === TELEMETRY_SYSTEMS.LINKEDIN && !config.telemetryStatusLinkedinEnabled) {
    return { posted: false, date, system, skippedReason: 'system_disabled' };
  }

  const key = postedKey(system, date);

  if (!forcing) {
    if (postedKeys.has(key)) {
      return { posted: false, date, system, skippedReason: 'already_posted' };
    }
    if (typeof repository.hasDailyStatusPost === 'function') {
      const durablePosted = await repository.hasDailyStatusPost(system, date);
      if (durablePosted) {
        postedKeys.add(key);
        return { posted: false, date, system, skippedReason: 'already_posted' };
      }
    }
  }

  if (!canUseWebhook() && !canUseBot()) {
    // eslint-disable-next-line no-console
    console.warn('telemetry.daily_status_skipped', {
      system,
      date,
      skippedReason: 'not_configured'
    });
    return { posted: false, date, system, skippedReason: 'not_configured' };
  }

  let status;
  try {
    status = await buildDailyStatus({
      repository,
      date,
      system,
      sourceType: sourceTypeForSystem(system)
    });
    const { blocks } = buildDailyStatusBlocks(status);
    await deliverStatus({ status, blocks });

    if (typeof repository.recordDailyStatusPost === 'function') {
      await repository.recordDailyStatusPost({
        system,
        date,
        run_id: status.run_id
      });
    }
    postedKeys.add(key);
    incrementTelemetryCounter('status_posted');

    // eslint-disable-next-line no-console
    console.info('telemetry.daily_status', {
      system: status.system,
      date: status.date,
      run_id: status.run_id,
      ingest: status.ingest,
      feeds_active: status.feeds_active,
      status
    });

    return { posted: true, date, system, status };
  } catch (error) {
    incrementTelemetryCounter('status_failed');
    // eslint-disable-next-line no-console
    console.warn('telemetry.daily_status_failed', {
      system,
      date,
      error: error?.message || String(error)
    });
    return {
      posted: false,
      date,
      system,
      skippedReason: 'delivery_failed',
      status
    };
  }
}

/**
 * Flush RSS daily status (back-compat wrapper).
 *
 * @param {{ repository: object, now?: Date, forceDate?: string }} input
 */
export async function flushRssDailyStatus(input = {}) {
  return flushDailyStatus({
    ...input,
    system: TELEMETRY_SYSTEM
  });
}

/**
 * Flush yesterday's status for all enabled systems.
 *
 * @param {{ repository: object, now?: Date }} input
 * @returns {Promise<{ date: string, results: object[] }>}
 */
export async function flushAllDailyStatuses({
  repository,
  now = new Date()
} = {}) {
  const date = yesterdayUtcDate(now);
  const systems = enabledDailyStatusSystems();
  if (systems.length === 0) {
    return {
      date,
      results: [{
        posted: false,
        date,
        system: TELEMETRY_SYSTEM,
        skippedReason: 'disabled'
      }]
    };
  }

  const results = [];
  for (const system of systems) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await flushDailyStatus({ repository, now, system }));
  }
  return { date, results };
}

/**
 * @param {{ status: object, blocks: object[] }} input
 */
async function deliverStatus({ status, blocks }) {
  const timeoutMs = config.telemetrySlackTimeoutMs;
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
  postedKeys.clear();
}
