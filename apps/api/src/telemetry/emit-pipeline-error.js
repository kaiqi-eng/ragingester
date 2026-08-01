import { config } from '../config.js';
import {
  buildDailyRunId,
  isTelemetrySourceType,
  systemForSourceType,
  workflowForSourceType
} from './constants.js';
import { incrementTelemetryCounter } from './metrics.js';
import {
  autoActionForClass,
  classifyErrorClass
} from './pipeline-error-class.js';
import {
  buildPipelineErrorBlocks,
  pipelineErrorFallbackText
} from './pipeline-error-blocks.js';
import {
  postPipelineErrorBot,
  postPipelineErrorWebhook
} from './slack-pipeline-errors.js';

function canUseWebhook() {
  return Boolean(config.telemetryPipelineErrorsSlackWebhookUrl);
}

function canUseBot() {
  return Boolean(config.slackBotToken && config.telemetryPipelineErrorsSlackChannelId);
}

/**
 * Format failure time like: Thu, 23 Jul 2026, 9:01AM UTC
 * @param {string | Date} timestamp
 * @returns {string}
 */
export function formatPipelineErrorTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  const weekday = date.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const day = date.toLocaleString('en-US', { day: 'numeric', timeZone: 'UTC' });
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = date.toLocaleString('en-US', { year: 'numeric', timeZone: 'UTC' });
  const time = date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  }).replace(' ', '');

  return `${weekday}, ${day} ${month} ${year}, ${time} UTC`;
}

/**
 * Emit a Bays-shaped pipeline-error Slack card for rss_feed / youtube / linkedin.
 *
 * Supports either a live card+run or a synthetic manual payload via failedNode/error/sourceType.
 *
 * @param {{
 *   card?: object,
 *   run?: object,
 *   error?: { name?: string, message?: string, code?: string, errorClass?: string },
 *   timestamp?: string,
 *   failedNode?: string,
 *   sourceType?: string,
 *   errorClass?: string
 * }} input
 * @returns {Promise<{ posted: boolean, skippedReason?: string, payload?: object }>}
 */
export async function emitPipelineError({
  card,
  run,
  error,
  timestamp,
  failedNode,
  sourceType,
  errorClass: errorClassOverride
} = {}) {
  if (!config.telemetryPipelineErrorsEnabled) {
    return { posted: false, skippedReason: 'disabled' };
  }

  const resolvedSourceType = sourceType || card?.source_type || 'rss_feed';
  if (!isTelemetrySourceType(resolvedSourceType)) {
    return { posted: false, skippedReason: 'unsupported_source_type' };
  }

  if (!canUseWebhook() && !canUseBot()) {
    // eslint-disable-next-line no-console
    console.warn('telemetry.pipeline_error_skipped', {
      skippedReason: 'not_configured',
      sourceType: resolvedSourceType,
      runId: run?.id
    });
    return { posted: false, skippedReason: 'not_configured' };
  }

  const failureTime = timestamp || new Date().toISOString();
  const day = new Date(failureTime).toISOString().slice(0, 10);
  const system = systemForSourceType(resolvedSourceType);
  const errorClass = errorClassOverride
    || error?.errorClass
    || classifyErrorClass(error || {});
  const payload = {
    workflow: workflowForSourceType(resolvedSourceType),
    failedNode: String(failedNode || card?.source_input || 'unknown'),
    errorClass,
    error: String(error?.message || run?.error || 'unknown error'),
    executionId: buildDailyRunId(day, system),
    time: formatPipelineErrorTime(failureTime),
    autoAction: autoActionForClass(errorClass),
    mention: config.telemetryPipelineErrorsMention || undefined
  };

  const text = pipelineErrorFallbackText(payload);
  const { blocks } = buildPipelineErrorBlocks(payload);

  try {
    await deliverPipelineError({ text, blocks });
    incrementTelemetryCounter('pipeline_error_posted');
    // eslint-disable-next-line no-console
    console.info('telemetry.pipeline_error', {
      system,
      sourceType: resolvedSourceType,
      executionId: payload.executionId,
      failedNode: payload.failedNode,
      errorClass: payload.errorClass,
      runId: run?.id
    });
    return { posted: true, payload };
  } catch (deliveryError) {
    incrementTelemetryCounter('pipeline_error_failed');
    // eslint-disable-next-line no-console
    console.warn('telemetry.pipeline_error_failed', {
      system,
      sourceType: resolvedSourceType,
      executionId: payload.executionId,
      runId: run?.id,
      error: deliveryError?.message || String(deliveryError)
    });
    return {
      posted: false,
      skippedReason: 'delivery_failed',
      payload
    };
  }
}

/** @deprecated Prefer emitPipelineError */
export async function emitRssPipelineError(input) {
  return emitPipelineError(input);
}

/**
 * @param {{ text: string, blocks: object[] }} input
 */
async function deliverPipelineError({ text, blocks }) {
  const timeoutMs = config.telemetrySlackTimeoutMs;
  const primary = canUseWebhook() ? 'webhook' : 'bot';
  const fallback = primary === 'webhook' ? 'bot' : 'webhook';

  try {
    await sendTransport(primary, { text, blocks, timeoutMs });
  } catch (primaryError) {
    if ((fallback === 'webhook' && !canUseWebhook()) || (fallback === 'bot' && !canUseBot())) {
      throw primaryError;
    }
    try {
      await sendTransport(fallback, { text, blocks, timeoutMs });
    } catch (fallbackError) {
      throw new Error(
        `pipeline-error delivery failed primary=${primaryError?.message || primaryError}; fallback=${fallbackError?.message || fallbackError}`
      );
    }
  }
}

/**
 * @param {'webhook' | 'bot'} transport
 * @param {{ text: string, blocks: object[], timeoutMs: number }} input
 */
async function sendTransport(transport, { text, blocks, timeoutMs }) {
  if (transport === 'webhook') {
    if (!canUseWebhook()) throw new Error('telemetry pipeline-errors webhook not configured');
    await postPipelineErrorWebhook({
      webhookUrl: config.telemetryPipelineErrorsSlackWebhookUrl,
      text,
      blocks,
      timeoutMs
    });
    return;
  }

  if (!canUseBot()) throw new Error('telemetry pipeline-errors bot not configured');
  await postPipelineErrorBot({
    botToken: config.slackBotToken,
    channelId: config.telemetryPipelineErrorsSlackChannelId,
    text,
    blocks,
    timeoutMs
  });
}
