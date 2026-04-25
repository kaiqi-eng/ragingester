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

export async function executeRun({ repository, card, triggerMode, timeoutMs, maxRetries }) {
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
  while (attempts <= maxRetries) {
    attempts += 1;
    await repository.updateRun(run.id, {
      status: RUN_STATUS.RUNNING,
      attempts,
      started_at: new Date().toISOString()
    });

    try {
      const collector = resolveCollector(card.source_type);
      const collected = await withTimeout(
        collector.collect({
          source_input: card.source_input,
          params: card.params,
          context: { card, runId: run.id, triggerMode: triggerMode || TRIGGER_MODE.MANUAL }
        }),
        timeoutMs
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
        logs: mergeLogs([{ level: 'info', message: 'run completed' }], collected?.logs)
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
      const failedState = {
        status: RUN_STATUS.FAILED,
        ended_at: endedAt,
        error: error instanceof Error ? error.message : String(error),
        logs: [{ level: 'error', message: error instanceof Error ? error.message : String(error) }]
      };
      await repository.updateRun(run.id, failedState);

      if (attempts > maxRetries) {
        const nextRunAt = card.schedule_enabled && card.cron_expression
          ? computeNextRun(card.cron_expression, card.timezone, new Date())
          : null;

        const nextParams = {
          ...(card.params || {})
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
