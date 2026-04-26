import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { runSchedulerTick } from '../src/scheduler/worker.js';

function isoMsOffset(baseIso, deltaMs) {
  return new Date(new Date(baseIso).getTime() + deltaMs).toISOString();
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
