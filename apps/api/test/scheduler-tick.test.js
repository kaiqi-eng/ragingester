import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_TYPES } from '@ragingester/shared';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { runSchedulerTick } from '../src/lib/scheduler-tick.js';

test('runSchedulerTick prewarms rss cards and executes due cards', async () => {
  const repository = createMemoryRepository();
  const now = new Date('2026-04-25T12:00:00.000Z');

  const dueCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: SOURCE_TYPES.IDENTIFIER_BASED,
    source_input: 'sensor-01',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: '2026-04-25T11:59:00.000Z',
    last_run_at: null,
    active: true
  });

  const prewarmCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: SOURCE_TYPES.RSS_FEED,
    source_input: 'https://example.com/feed.xml',
    params: {
      genie_rss_base_url: 'https://genie.example',
      genie_rss_api_key: 'genie-key'
    },
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: '2026-04-25T12:01:00.000Z',
    last_run_at: null,
    active: true
  });

  const originalFetch = global.fetch;
  const prewarmCalls = [];
  global.fetch = async (url) => {
    prewarmCalls.push(url);
    if (url.endsWith('/health')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' })
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    await runSchedulerTick({
      repository,
      now,
      prewarmWindowMs: 120000,
      timeoutMs: 5000,
      maxRetries: 0
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(prewarmCalls.length, 1);
  assert.equal(prewarmCalls[0], 'https://genie.example/health');

  const updatedPrewarmCard = await repository.getCardById(prewarmCard.id, prewarmCard.owner_id);
  assert.equal(updatedPrewarmCard.params.rss_prewarm_for, '2026-04-25T12:01:00.000Z');
  assert.equal(updatedPrewarmCard.params.rss_prewarmed_at, now.toISOString());

  const runs = await repository.listRuns(dueCard.id, dueCard.owner_id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'success');
});
