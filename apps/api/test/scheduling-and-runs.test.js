import test from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGER_MODE } from '@ragingester/shared';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { executeRun } from '../src/lib/run-engine.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';

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

test('create card returns 400 when schedule is enabled without cron_expression', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-no-cron',
        params: {},
        schedule_enabled: true,
        active: true
      })
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'cron_expression is required when schedule_enabled is true');
  });

  resetRepositoryForTests();
});

test('create card accepts null or empty run policy fields', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const nullResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'policy-null',
        params: {},
        run_timeout_ms: null,
        run_max_retries: null,
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(nullResponse.status, 201);
    const nullCard = await nullResponse.json();
    assert.equal(nullCard.run_timeout_ms, null);
    assert.equal(nullCard.run_max_retries, null);

    const emptyResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'policy-empty',
        params: {},
        run_timeout_ms: '',
        run_max_retries: '',
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(emptyResponse.status, 201);
    const emptyCard = await emptyResponse.json();
    assert.equal(emptyCard.run_timeout_ms, null);
    assert.equal(emptyCard.run_max_retries, null);
  });

  resetRepositoryForTests();
});

test('create card rejects out-of-range run policy fields', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const timeoutResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'policy-timeout-invalid',
        params: {},
        run_timeout_ms: 500,
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(timeoutResponse.status, 400);
    const timeoutBody = await timeoutResponse.json();
    assert.equal(timeoutBody.error, 'run_timeout_ms must be between 1000 and 300000');

    const retriesResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'policy-retries-invalid',
        params: {},
        run_max_retries: 8,
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(retriesResponse.status, 400);
    const retriesBody = await retriesResponse.json();
    assert.equal(retriesBody.error, 'run_max_retries must be between 0 and 5');
  });

  resetRepositoryForTests();
});

test('schedule preview returns 400 when card has no cron expression', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-preview',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const previewResponse = await fetch(`${baseUrl}/cards/${created.id}/schedule/preview`, {
      headers: authHeaders('user-a')
    });
    assert.equal(previewResponse.status, 400);
    const body = await previewResponse.json();
    assert.equal(body.error, 'cron_expression is required');
  });

  resetRepositoryForTests();
});

test('manual run succeeds for identifier-based card and can be fetched by owner only', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-run',
        params: { unit: 'celsius' },
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const runResponse = await fetch(`${baseUrl}/cards/${created.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(runResponse.status, 202);
    const run = await runResponse.json();
    assert.ok(run.id);
    assert.equal(run.owner_id, 'user-a');
    assert.equal(run.status, 'success');
    assert.equal(run.trigger_mode, 'manual');
    assert.equal(run.attempts, 1);
    assert.equal(run.error_payload, null);
    assert.ok(Array.isArray(run.logs));
    assert.ok(run.logs.some((entry) => entry.event === 'attempt_started'));
    assert.ok(run.logs.some((entry) => entry.event === 'run_completed'));

    const getRunResponse = await fetch(`${baseUrl}/runs/${run.id}`, {
      headers: authHeaders('user-a')
    });
    assert.equal(getRunResponse.status, 200);
    const fetchedRun = await getRunResponse.json();
    assert.equal(fetchedRun.id, run.id);

    const foreignGetRunResponse = await fetch(`${baseUrl}/runs/${run.id}`, {
      headers: authHeaders('user-b')
    });
    assert.equal(foreignGetRunResponse.status, 404);
  });

  resetRepositoryForTests();
});

test('manual run uses per-card run_max_retries override', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'http_api',
        source_input: 'not-a-valid-url',
        params: {},
        run_timeout_ms: 2000,
        run_max_retries: 2,
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const runResponse = await fetch(`${baseUrl}/cards/${created.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(runResponse.status, 202);
    const run = await runResponse.json();
    assert.equal(run.status, 'failed');
    assert.equal(run.attempts, 3);
    assert.equal(run.trigger_mode, 'manual');
    assert.ok(run.error_payload);
    assert.equal(run.error_payload.name, 'TypeError');
    assert.ok(Array.isArray(run.logs));
    assert.equal(run.logs.filter((entry) => entry.event === 'attempt_started').length, 3);
    assert.equal(run.logs.filter((entry) => entry.event === 'attempt_failed').length, 3);
  });

  resetRepositoryForTests();
});

test('manual run falls back to global retry default when card override is null', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'http_api',
        source_input: 'not-a-valid-url',
        params: {},
        run_timeout_ms: null,
        run_max_retries: null,
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const runResponse = await fetch(`${baseUrl}/cards/${created.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(runResponse.status, 202);
    const run = await runResponse.json();
    assert.equal(run.status, 'failed');
    assert.equal(run.attempts, config.runMaxRetries + 1);
    assert.ok(run.error_payload);
    assert.equal(run.error_payload.name, 'TypeError');
    assert.ok(Array.isArray(run.logs));
  });

  resetRepositoryForTests();
});

test('manual run uses per-card run_timeout_ms override', async () => {
  const repository = createMemoryRepository();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'http_api',
      source_input: 'https://example.com/slow',
      params: {},
      run_timeout_ms: 10,
      run_max_retries: 0,
      schedule_enabled: false,
      cron_expression: null,
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.MANUAL,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    assert.equal(run.attempts, 1);
    assert.match(run.error, /run timed out after 10ms/);
    assert.ok(run.error_payload);
    assert.equal(run.error_payload.message, 'run timed out after 10ms');
    assert.ok(Array.isArray(run.logs));
    assert.ok(run.logs.some((entry) => entry.event === 'attempt_failed'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('manual run returns 409 when an active run already exists for the card', async () => {
  const repository = createMemoryRepository();
  setRepositoryForTests(repository);

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-overlap',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    await repository.createRun({
      card_id: created.id,
      owner_id: 'user-a',
      status: 'running',
      trigger_mode: 'manual',
      attempts: 1,
      started_at: new Date().toISOString(),
      ended_at: null,
      error: null,
      logs: []
    });

    const runResponse = await fetch(`${baseUrl}/cards/${created.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(runResponse.status, 409);
    const body = await runResponse.json();
    assert.equal(body.error, 'card already has an active run');
  });

  resetRepositoryForTests();
});

test('failed rss_feed run does not update rss_cursor_pub_date', async () => {
  const repository = createMemoryRepository();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('forced fetch failure');
  };

  try {
    const initialCursor = '2026-04-30T00:07:15.000Z';
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'rss_feed',
      source_input: 'https://techcrunch.com/feed/',
      params: {
        rss_cursor_pub_date: initialCursor
      },
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: false,
      cron_expression: null,
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.MANUAL,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const updatedCard = await repository.getCardById(card.id, card.owner_id);
    assert.equal(updatedCard.params.rss_cursor_pub_date, initialCursor);
  } finally {
    global.fetch = originalFetch;
  }
});

test('failed scheduled rss_feed run does not update rss_cursor_pub_date', async () => {
  const repository = createMemoryRepository();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('forced fetch failure');
  };

  try {
    const initialCursor = '2026-04-30T00:07:15.000Z';
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'rss_feed',
      source_input: 'https://techcrunch.com/feed/',
      params: {
        rss_cursor_pub_date: initialCursor
      },
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: true,
      cron_expression: '*/15 * * * *',
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.SCHEDULED,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const updatedCard = await repository.getCardById(card.id, card.owner_id);
    assert.equal(updatedCard.params.rss_cursor_pub_date, initialCursor);
  } finally {
    global.fetch = originalFetch;
  }
});

test('failed youtube run does not update youtube_cursor_pub_date', async () => {
  const repository = createMemoryRepository();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('forced fetch failure');
  };

  try {
    const initialCursor = '2026-04-30T00:07:15.000Z';
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'youtube',
      source_input: 'UCqzK60-oUOEq36uU9B1MMUg',
      params: {
        youtube_cursor_pub_date: initialCursor
      },
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: false,
      cron_expression: null,
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.MANUAL,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const updatedCard = await repository.getCardById(card.id, card.owner_id);
    assert.equal(updatedCard.params.youtube_cursor_pub_date, initialCursor);
  } finally {
    global.fetch = originalFetch;
  }
});

test('failed scheduled youtube run does not update youtube_cursor_pub_date', async () => {
  const repository = createMemoryRepository();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('forced fetch failure');
  };

  try {
    const initialCursor = '2026-04-30T00:07:15.000Z';
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'youtube',
      source_input: 'UCqzK60-oUOEq36uU9B1MMUg',
      params: {
        youtube_cursor_pub_date: initialCursor
      },
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: true,
      cron_expression: '*/15 * * * *',
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.SCHEDULED,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const updatedCard = await repository.getCardById(card.id, card.owner_id);
    assert.equal(updatedCard.params.youtube_cursor_pub_date, initialCursor);
  } finally {
    global.fetch = originalFetch;
  }
});

test('failed smartcursor_link run does not update smartcursor_workspace_id', async () => {
  const repository = createMemoryRepository();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('forced fetch failure');
  };

  try {
    const initialWorkspace = 'ws-existing';
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'smartcursor_link',
      source_input: 'https://example.com/private',
      params: {
        smartcursor_workspace_id: initialWorkspace
      },
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: false,
      cron_expression: null,
      timezone: 'America/Chicago',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      triggerMode: TRIGGER_MODE.MANUAL,
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const updatedCard = await repository.getCardById(card.id, card.owner_id);
    assert.equal(updatedCard.params.smartcursor_workspace_id, initialWorkspace);
  } finally {
    global.fetch = originalFetch;
  }
});

test('list all runs returns only the requesting owner history', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createA = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-all-runs-a',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createA.status, 201);
    const cardA = await createA.json();

    const createB = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-b'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-all-runs-b',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createB.status, 201);
    const cardB = await createB.json();

    await fetch(`${baseUrl}/cards/${cardA.id}/run`, { method: 'POST', headers: authHeaders('user-a') });
    await fetch(`${baseUrl}/cards/${cardB.id}/run`, { method: 'POST', headers: authHeaders('user-b') });

    const userARunsResponse = await fetch(`${baseUrl}/runs`, { headers: authHeaders('user-a') });
    assert.equal(userARunsResponse.status, 200);
    const userARuns = await userARunsResponse.json();
    assert.equal(userARuns.length, 1);
    assert.equal(userARuns[0].owner_id, 'user-a');
    assert.equal(userARuns[0].card_id, cardA.id);
  });

  resetRepositoryForTests();
});

test('clear run history deletes runs for selected card only', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createA = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-clear-a',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createA.status, 201);
    const cardA = await createA.json();

    const createB = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-clear-b',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createB.status, 201);
    const cardB = await createB.json();

    await fetch(`${baseUrl}/cards/${cardA.id}/run`, { method: 'POST', headers: authHeaders('user-a') });
    await fetch(`${baseUrl}/cards/${cardB.id}/run`, { method: 'POST', headers: authHeaders('user-a') });

    const clearResponse = await fetch(`${baseUrl}/cards/${cardA.id}/runs`, {
      method: 'DELETE',
      headers: authHeaders('user-a')
    });
    assert.equal(clearResponse.status, 200);
    const clearBody = await clearResponse.json();
    assert.equal(clearBody.deleted, 1);

    const runsAResponse = await fetch(`${baseUrl}/cards/${cardA.id}/runs`, { headers: authHeaders('user-a') });
    assert.equal(runsAResponse.status, 200);
    const runsA = await runsAResponse.json();
    assert.equal(runsA.length, 0);

    const runsBResponse = await fetch(`${baseUrl}/cards/${cardB.id}/runs`, { headers: authHeaders('user-a') });
    assert.equal(runsBResponse.status, 200);
    const runsB = await runsBResponse.json();
    assert.equal(runsB.length, 1);
  });

  resetRepositoryForTests();
});
