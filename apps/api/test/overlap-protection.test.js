import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { runSchedulerTick } from '../src/scheduler/worker.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';
import { RunOverlapError } from '../src/lib/errors.js';

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function authHeaders(userId) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId
  };
}

test('memory repository rejects second active run for same card', async () => {
  const repository = createMemoryRepository();
  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'overlap-card-1',
    params: {},
    schedule_enabled: false,
    cron_expression: null,
    timezone: 'America/Chicago',
    next_run_at: null,
    last_run_at: null,
    active: true
  });

  await repository.createRun({
    card_id: card.id,
    owner_id: 'user-a',
    status: 'running',
    trigger_mode: 'manual',
    attempts: 1,
    started_at: new Date().toISOString(),
    ended_at: null,
    error: null,
    logs: []
  });

  await assert.rejects(
    repository.createRun({
      card_id: card.id,
      owner_id: 'user-a',
      status: 'pending',
      trigger_mode: 'manual',
      attempts: 0,
      started_at: null,
      ended_at: null,
      error: null,
      logs: []
    }),
    RunOverlapError
  );
});

test('manual run returns 409 when overlap is detected during run creation', async () => {
  const repository = createMemoryRepository();
  setRepositoryForTests(repository);

  await withServer(async (baseUrl) => {
    const createCardResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'overlap-card-2',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createCardResponse.status, 201);
    const card = await createCardResponse.json();

    await repository.createRun({
      card_id: card.id,
      owner_id: 'user-a',
      status: 'running',
      trigger_mode: 'manual',
      attempts: 1,
      started_at: new Date().toISOString(),
      ended_at: null,
      error: null,
      logs: []
    });

    // Simulate a stale overlap pre-check so execution reaches repository.createRun.
    repository.getActiveRunForCard = async () => null;

    const runResponse = await fetch(`${baseUrl}/cards/${card.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });

    assert.equal(runResponse.status, 409);
    const body = await runResponse.json();
    assert.equal(body.error, 'card already has an active run');
  });

  resetRepositoryForTests();
});

test('scheduler tick treats overlap conflict as skipped card', async () => {
  const repository = createMemoryRepository();
  const nowIso = new Date().toISOString();
  const pastIso = new Date(Date.now() - 60_000).toISOString();

  const card = await repository.createCard({
    owner_id: 'user-a',
    source_type: 'identifier_based',
    source_input: 'overlap-card-3',
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

  // Simulate stale overlap pre-check.
  repository.getActiveRunForCard = async () => null;

  const result = await runSchedulerTick({ repository, nowIso, timeoutMs: 5000, maxRetries: 0 });
  assert.equal(result.dueCards, 1);
  assert.equal(result.startedRuns, 0);
  assert.equal(result.skippedCards, 1);
});
