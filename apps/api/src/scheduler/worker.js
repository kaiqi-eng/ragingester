import { TRIGGER_MODE } from '@ragingester/shared';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import { executeRun } from '../lib/run-engine.js';

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

    await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.SCHEDULED,
      timeoutMs,
      maxRetries
    });
    startedRuns += 1;
  }

  return {
    dueCards: dueCards.length,
    startedRuns,
    skippedCards
  };
}

export function startScheduler({ pollMs = config.schedulerPollMs } = {}) {
  return setInterval(() => {
    runSchedulerTick().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('scheduler tick failed', error);
    });
  }, pollMs);
}

const isMainModule = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  startScheduler();

  // eslint-disable-next-line no-console
  console.log(`Scheduler running every ${config.schedulerPollMs}ms`);
}
