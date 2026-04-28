import { TRIGGER_MODE } from '@ragingester/shared';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import { executeRun } from '../lib/run-engine.js';
import { RunOverlapError } from '../lib/errors.js';

export async function runSchedulerTick({
  repository = getRepository(),
  nowIso = new Date().toISOString(),
  timeoutMs = config.runTimeoutMs,
  maxRetries = config.runMaxRetries
} = {}) {
  const dueCards = await repository.listDueCards(nowIso);
  let startedRuns = 0;
  let skippedCards = 0;

  for (const card of dueCards) {
    const activeRun = await repository.getActiveRunForCard(card.id);
    if (activeRun) {
      skippedCards += 1;
      continue;
    }

    try {
      await executeRun({
        repository,
        card,
        triggerMode: TRIGGER_MODE.SCHEDULED,
        timeoutMs,
        maxRetries
      });
      startedRuns += 1;
    } catch (error) {
      if (error instanceof RunOverlapError) {
        skippedCards += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    dueCards: dueCards.length,
    startedRuns,
    skippedCards
  };
}

export function startScheduler({ pollMs = config.schedulerPollMs } = {}) {
  const runTick = () => {
    runSchedulerTick().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('scheduler tick failed', error);
    });
  };

  // Catch up overdue runs immediately when the worker starts,
  // instead of waiting for the first poll interval.
  runTick();

  return setInterval(runTick, pollMs);
}

const isMainModule = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  startScheduler();

  // eslint-disable-next-line no-console
  console.log(`Scheduler running every ${config.schedulerPollMs}ms`);
}
