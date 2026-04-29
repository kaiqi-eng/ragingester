import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';
import { runSchedulerTick, startScheduler } from '../src/scheduler/worker.js';

function isoMsOffset(baseIso, deltaMs) {
  return new Date(new Date(baseIso).getTime() + deltaMs).toISOString();
}

async function waitFor(predicate, { timeoutMs = 500, intervalMs = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

test('scheduler tick executes due cards and recomputes next_run_at', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -120_000);

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-card-1',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  const result = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });

  assert.equal(result.dueCards, 1);
  assert.equal(result.startedRuns, 1);
  assert.equal(result.skippedCards, 0);

  const runs = await repository.listRuns(card.id, 'user-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger_mode, 'scheduled');
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].error_payload, null);
  assert.ok(Array.isArray(runs[0].logs));
  assert.ok(runs[0].logs.some((entry) => entry.event === 'attempt_started'));
  assert.ok(runs[0].logs.some((entry) => entry.event === 'run_completed'));

  const updatedCard = await repository.getCardById(card.id, 'user-a');
  assert.ok(updatedCard.last_run_at);
  assert.ok(updatedCard.next_run_at);
  assert.ok(new Date(updatedCard.next_run_at).getTime() > new Date(nowIso).getTime());
});

test('scheduler tick skips due cards that already have an active run', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -120_000);

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-card-2',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  await repository.createRun({
    card_id: card.id,
    owner_id: 'user-a',
    status: 'running',
    trigger_mode: 'scheduled',
    attempts: 1,
    started_at: nowIso,
    ended_at: null,
    error: null,
    logs: []
  });

  const result = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });

  assert.equal(result.dueCards, 1);
  assert.equal(result.startedRuns, 0);
  assert.equal(result.skippedCards, 1);

  const runs = await repository.listRuns(card.id, 'user-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'running');
});

test('scheduler tick uses per-card run_max_retries override', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -120_000);

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'http_api',
    source_input: 'not-a-valid-url',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    run_timeout_ms: 2000,
    run_max_retries: 2,
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  const result = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });
  assert.equal(result.startedRuns, 1);

  const runs = await repository.listRuns(card.id, 'user-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].attempts, 3);
  assert.equal(runs[0].trigger_mode, 'scheduled');
  assert.ok(runs[0].error_payload);
  assert.equal(runs[0].error_payload.name, 'TypeError');
  assert.ok(Array.isArray(runs[0].logs));
  assert.equal(runs[0].logs.filter((entry) => entry.event === 'attempt_started').length, 3);
  assert.equal(runs[0].logs.filter((entry) => entry.event === 'attempt_failed').length, 3);
});

test('scheduler tick falls back to global retries when per-card override is null', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -120_000);

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'http_api',
    source_input: 'not-a-valid-url',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    run_timeout_ms: null,
    run_max_retries: null,
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  const result = await runSchedulerTick({
    repository,
    nowIso,
    timeoutMs: config.runTimeoutMs,
    maxRetries: config.runMaxRetries
  });
  assert.equal(result.startedRuns, 1);

  const runs = await repository.listRuns(card.id, 'user-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].attempts, config.runMaxRetries + 1);
  assert.ok(runs[0].error_payload);
  assert.equal(runs[0].error_payload.name, 'TypeError');
  assert.ok(Array.isArray(runs[0].logs));
});

test('startScheduler runs immediate catch-up tick for overdue cards', async () => {
  const repository = createMemoryRepository();
  setRepositoryForTests(repository);

  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -300_000);

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-immediate-catchup',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  const timer = startScheduler({ pollMs: 60_000 });

  try {
    await waitFor(async () => {
      const runs = await repository.listRuns(card.id, 'user-a');
      return runs.length === 1;
    });

    const runs = await repository.listRuns(card.id, 'user-a');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].trigger_mode, 'scheduled');
  } finally {
    clearInterval(timer);
    resetRepositoryForTests();
  }
});
