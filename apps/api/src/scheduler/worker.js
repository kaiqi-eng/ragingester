import { config } from '../config.js';
import { getRepository } from '../repository/index.js';
import { runSchedulerTick } from '../lib/scheduler-tick.js';

async function runTick() {
  const repository = getRepository();
  await runSchedulerTick({ repository });
}

setInterval(() => {
  runTick().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('scheduler tick failed', error);
  });
}, config.schedulerPollMs);

// eslint-disable-next-line no-console
console.log(`Scheduler running every ${config.schedulerPollMs}ms`);
