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

function resolveRunPolicy(card, { defaultTimeoutMs, defaultMaxRetries }) {
  return {
    effectiveTimeoutMs: card.run_timeout_ms ?? defaultTimeoutMs,
    effectiveMaxRetries: card.run_max_retries ?? defaultMaxRetries
  };
}

export async function executeRun({ repository, card, triggerMode, timeoutMs, maxRetries }) {
  const { effectiveTimeoutMs, effectiveMaxRetries } = resolveRunPolicy(card, {
    defaultTimeoutMs: timeoutMs,
    defaultMaxRetries: maxRetries
  });

  const run = await repository.createRun({
    card_id: card.id,
    owner_id: card.owner_id,
    status: RUN_STATUS.PENDING,
    trigger_mode: triggerMode || TRIGGER_MODE.MANUAL,
    attempts: 0,
    started_at: null,
    ended_at: null,
    error: null,
    logs: []
  });

  let attempts = 0;
  while (attempts <= effectiveMaxRetries) {
    attempts += 1;
    await repository.updateRun(run.id, {
      status: RUN_STATUS.RUNNING,
      attempts,
      started_at: new Date().toISOString()
    });

    try {
      const collector = resolveCollector(card.source_type);
      const collected = await withTimeout(
        collector.collect({ source_input: card.source_input, params: card.params, context: { card, runId: run.id } }),
        effectiveTimeoutMs
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
        logs: [{ level: 'info', message: 'run completed' }]
      };
      await repository.updateRun(run.id, updates);

      const nextRunAt = card.schedule_enabled && card.cron_expression
        ? computeNextRun(card.cron_expression, card.timezone, new Date())
        : null;

      await repository.updateCard(card.id, {
        last_run_at: updates.ended_at,
        next_run_at: nextRunAt
      });

      return repository.getRunById(run.id, card.owner_id);
    } catch (error) {
      const failedState = {
        status: RUN_STATUS.FAILED,
        ended_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        logs: [{ level: 'error', message: error instanceof Error ? error.message : String(error) }]
      };
      await repository.updateRun(run.id, failedState);

      if (attempts > effectiveMaxRetries) {
        return repository.getRunById(run.id, card.owner_id);
      }
    }
  }

  return repository.getRunById(run.id, card.owner_id);
}
