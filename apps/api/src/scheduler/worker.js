import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import { runSchedulerTick as runSchedulerTickCore } from '../lib/scheduler-tick.js';

export async function runSchedulerTick({
  repository = getRepository(),
  nowIso = new Date().toISOString(),
  timeoutMs = config.runTimeoutMs,
  maxRetries = config.runMaxRetries
} = {}) {
  return runSchedulerTickCore({
    repository,
    now: new Date(nowIso),
    timeoutMs,
    maxRetries
  });
}

export function startScheduler({ pollMs = config.schedulerPollMs } = {}) {
  let tickInFlight = false;

  const runTick = () => {
    if (tickInFlight) return;
    tickInFlight = true;

    runSchedulerTick()
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('scheduler tick failed', error);
      })
      .finally(() => {
        tickInFlight = false;
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
