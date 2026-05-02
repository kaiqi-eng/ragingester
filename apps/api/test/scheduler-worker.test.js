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
  assert.equal(result.enqueuedRuns, 1);
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
  assert.equal(result.enqueuedRuns, 0);
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
  assert.equal(result.enqueuedRuns, 1);
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
  assert.equal(result.enqueuedRuns, 1);
  assert.equal(result.startedRuns, 1);

  const runs = await repository.listRuns(card.id, 'user-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].attempts, config.runMaxRetries + 1);
  assert.ok(runs[0].error_payload);
  assert.equal(runs[0].error_payload.name, 'TypeError');
  assert.ok(Array.isArray(runs[0].logs));
});

test('scheduler tick queues multiple due cards but only executes one per tick', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = isoMsOffset(nowIso, -120_000);

  const firstCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-queued-card-1',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });
  const secondCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-queued-card-2',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: pastIso,
    last_run_at: null,
    active: true
  });

  const firstTick = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });
  assert.equal(firstTick.dueCards, 2);
  assert.equal(firstTick.enqueuedRuns, 2);
  assert.equal(firstTick.startedRuns, 1);
  assert.equal(firstTick.skippedCards, 0);

  const firstCardRunsAfterFirstTick = await repository.listRuns(firstCard.id, 'user-a');
  const secondCardRunsAfterFirstTick = await repository.listRuns(secondCard.id, 'user-a');
  const statusesAfterFirstTick = [
    ...firstCardRunsAfterFirstTick,
    ...secondCardRunsAfterFirstTick
  ].map((run) => run.status);
  assert.equal(statusesAfterFirstTick.filter((status) => status === 'success').length, 1);
  assert.equal(statusesAfterFirstTick.filter((status) => status === 'pending').length, 1);

  const secondTick = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });
  assert.equal(secondTick.enqueuedRuns, 0);
  assert.equal(secondTick.startedRuns, 1);
  assert.equal(secondTick.skippedCards, 1);

  const firstCardRunsAfterSecondTick = await repository.listRuns(firstCard.id, 'user-a');
  const secondCardRunsAfterSecondTick = await repository.listRuns(secondCard.id, 'user-a');
  const allRuns = [
    ...firstCardRunsAfterSecondTick,
    ...secondCardRunsAfterSecondTick
  ];
  assert.equal(allRuns.filter((run) => run.status === 'success').length, 2);
  assert.equal(allRuns.filter((run) => run.status === 'pending').length, 0);
});

test('scheduled queue claim is blocked while another scheduled run is running', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();

  const queuedCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-claim-queued',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: nowIso,
    last_run_at: null,
    active: true
  });
  const runningCard = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'scheduler-claim-running',
    params: {},
    schedule_enabled: true,
    cron_expression: '*/5 * * * *',
    timezone: 'America/Chicago',
    next_run_at: nowIso,
    last_run_at: null,
    active: true
  });

  await repository.enqueueScheduledRun(queuedCard);
  await repository.createRun({
    card_id: runningCard.id,
    owner_id: runningCard.owner_id,
    status: 'running',
    trigger_mode: 'scheduled',
    attempts: 1,
    started_at: nowIso,
    ended_at: null,
    error: null,
    logs: []
  });

  const claimed = await repository.claimNextScheduledRun();
  assert.equal(claimed, null);
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
