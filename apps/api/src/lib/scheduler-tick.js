import { SOURCE_TYPES, TRIGGER_MODE } from '@ragingester/shared';
import { config } from '../config.js';
import { prewarmRssFeed } from '../collectors/rss-feed.js';
import { executeRun } from './run-engine.js';
import { RunOverlapError } from './errors.js';

async function handlePrewarm({ repository, now, prewarmWindowMs }) {
  if (typeof repository.listPrewarmCards !== 'function') return;

  const nowIso = now.toISOString();
  const upperIso = new Date(now.getTime() + prewarmWindowMs).toISOString();
  const prewarmCards = await repository.listPrewarmCards(nowIso, upperIso);

  for (const card of prewarmCards) {
    if (card.source_type !== SOURCE_TYPES.RSS_FEED) continue;

    const params = card.params || {};
    if (params.rss_prewarm_for === card.next_run_at) continue;

    try {
      await prewarmRssFeed({ params });
      await repository.updateCard(card.id, {
        params: {
          ...params,
          rss_prewarm_for: card.next_run_at,
          rss_prewarmed_at: nowIso
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`rss prewarm failed for card ${card.id}`, error);
    }
  }
}

export async function runSchedulerTick({
  repository,
  now = new Date(),
  prewarmWindowMs = config.rssPrewarmWindowMs,
  timeoutMs = config.runTimeoutMs,
  maxRetries = config.runMaxRetries
}) {
  await handlePrewarm({ repository, now, prewarmWindowMs });

  const dueCards = await repository.listDueCards(now.toISOString());
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
