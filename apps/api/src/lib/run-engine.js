import { RUN_STATUS, TRIGGER_MODE } from '@ragingester/shared';
import { computeNextRun } from './cron.js';
import { resolveCollector } from '../collectors/index.js';

async function withTimeout(promise, timeoutMs) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`run timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function mergeLogs(existingLogs, nextLogs) {
  const safeExisting = Array.isArray(existingLogs) ? existingLogs : [];
  const safeNext = Array.isArray(nextLogs) ? nextLogs : [];
  return [...safeExisting, ...safeNext];
}

function applyCardParamUpdates(card, collected) {
  const nextParams = {
    ...(card.params || {}),
    ...((collected?.card_updates?.params && typeof collected.card_updates.params === 'object') ? collected.card_updates.params : {})
  };

  delete nextParams.rss_prewarm_for;
  delete nextParams.rss_prewarmed_at;

  return nextParams;
}

function resolveRunPolicy(card, { defaultTimeoutMs, defaultMaxRetries }) {
  return {
    effectiveTimeoutMs: card.run_timeout_ms ?? defaultTimeoutMs,
    effectiveMaxRetries: card.run_max_retries ?? defaultMaxRetries
  };
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.code ? { code: String(error.code) } : {})
    };
  }

  return {
    name: 'Error',
    message: String(error)
  };
}

function cloneParams(params) {
  if (!params || typeof params !== 'object') return {};
  return JSON.parse(JSON.stringify(params));
}

async function executeRunRecord({ repository, card, run, triggerMode, timeoutMs, maxRetries }) {
  const { effectiveTimeoutMs, effectiveMaxRetries } = resolveRunPolicy(card, {
    defaultTimeoutMs: timeoutMs,
    defaultMaxRetries: maxRetries
  });
  const resolvedTriggerMode = triggerMode || TRIGGER_MODE.MANUAL;
  const isManualRssFeed = resolvedTriggerMode === TRIGGER_MODE.MANUAL && card.source_type === 'rss_feed';
  const timeoutMsForRun = isManualRssFeed ? Math.max(effectiveTimeoutMs, 10 * 60 * 1000) : effectiveTimeoutMs;
  const initialParamsSnapshot = cloneParams(card.params);
  const logs = [];

  let attempts = 0;
  while (attempts <= effectiveMaxRetries) {
    attempts += 1;
    logs.push({
      level: 'info',
      event: 'attempt_started',
      attempt: attempts,
      trigger_mode: resolvedTriggerMode,
      timeout_ms: timeoutMsForRun,
      max_retries: effectiveMaxRetries
    });

    await repository.updateRun(run.id, {
      status: RUN_STATUS.RUNNING,
      attempts,
      started_at: new Date().toISOString(),
      logs
    });

    try {
      const collector = resolveCollector(card.source_type);
      const collected = await withTimeout(
        collector.collect({
          source_input: card.source_input,
          params: card.params,
          context: { card, runId: run.id, triggerMode: resolvedTriggerMode, timeoutMs: timeoutMsForRun }
        }),
        timeoutMsForRun
      );

      await repository.createCollectedData({
        run_id: run.id,
        owner_id: card.owner_id,
        raw_data: collected.raw,
        normalized_data: collected.normalized,
        metadata: { metrics: collected.metrics || {}, source_type: card.source_type }
      });

      const updates = {
        status: RUN_STATUS.SUCCESS,
        ended_at: new Date().toISOString(),
        error: null,
        error_payload: null,
        logs: mergeLogs(
          [...logs, { level: 'info', event: 'run_completed', message: 'run completed', attempt: attempts }],
          collected?.logs
        )
      };
      await repository.updateRun(run.id, updates);

      const nextRunAt = card.schedule_enabled && card.cron_expression
        ? computeNextRun(card.cron_expression, card.timezone, new Date())
        : null;

      await repository.updateCard(card.id, {
        last_run_at: updates.ended_at,
        next_run_at: nextRunAt,
        params: applyCardParamUpdates(card, collected)
      });

      return repository.getRunById(run.id, card.owner_id);
    } catch (error) {
      const endedAt = new Date().toISOString();
      const errorPayload = serializeError(error);
      logs.push({
        level: 'error',
        event: 'attempt_failed',
        attempt: attempts,
        error: errorPayload
      });

      const retriesExhausted = attempts > effectiveMaxRetries;
      const failedState = {
        status: retriesExhausted ? RUN_STATUS.FAILED : RUN_STATUS.RUNNING,
        ended_at: retriesExhausted ? endedAt : null,
        error: errorPayload.message,
        error_payload: errorPayload,
        logs
      };
      await repository.updateRun(run.id, failedState);

      if (retriesExhausted) {
        const nextRunAt = card.schedule_enabled && card.cron_expression
          ? computeNextRun(card.cron_expression, card.timezone, new Date())
          : null;

        const nextParams = {
          ...initialParamsSnapshot
        };
        delete nextParams.rss_prewarm_for;
        delete nextParams.rss_prewarmed_at;

        await repository.updateCard(card.id, {
          last_run_at: endedAt,
          next_run_at: nextRunAt,
          params: nextParams
        });
        return repository.getRunById(run.id, card.owner_id);
      }
    }
  }

  return repository.getRunById(run.id, card.owner_id);
}

export async function executeRun({ repository, card, triggerMode, timeoutMs, maxRetries }) {
  const resolvedTriggerMode = triggerMode || TRIGGER_MODE.MANUAL;
  const run = await repository.createRun({
    card_id: card.id,
    owner_id: card.owner_id,
    status: RUN_STATUS.PENDING,
    trigger_mode: resolvedTriggerMode,
    attempts: 0,
    started_at: null,
    ended_at: null,
    error: null,
    error_payload: null,
    logs: []
  });

  return executeRunRecord({
    repository,
    card,
    run,
    triggerMode: resolvedTriggerMode,
    timeoutMs,
    maxRetries
  });
}

export async function executeQueuedRun({ repository, card, run, timeoutMs, maxRetries }) {
  return executeRunRecord({
    repository,
    card,
    run,
    triggerMode: run.trigger_mode || TRIGGER_MODE.SCHEDULED,
    timeoutMs,
    maxRetries
  });
}
