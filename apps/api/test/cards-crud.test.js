import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
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

test('cards CRUD and owner isolation', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-001',
        params: { region: 'north' },
        schedule_enabled: true,
        cron_expression: '0 9 * * *',
        timezone: 'America/Chicago',
        run_timeout_ms: 45000,
        run_max_retries: 2,
        active: true
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.source_type, 'identifier_based');
    assert.equal(created.owner_id, 'user-a');
    assert.ok(created.id);
    assert.ok(created.next_run_at);
    assert.equal(created.run_timeout_ms, 45000);
    assert.equal(created.run_max_retries, 2);

    const listResponse = await fetch(`${baseUrl}/cards`, {
      headers: authHeaders('user-a')
    });
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const getResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
      headers: authHeaders('user-a')
    });
    assert.equal(getResponse.status, 200);
    const fetched = await getResponse.json();
    assert.equal(fetched.id, created.id);

    const updateResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_input: 'sensor-001-updated',
        schedule_enabled: false,
        run_timeout_ms: null,
        run_max_retries: 0,
        active: false
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.source_input, 'sensor-001-updated');
    assert.equal(updated.schedule_enabled, false);
    assert.equal(updated.cron_expression, null);
    assert.equal(updated.next_run_at, null);
    assert.equal(updated.run_timeout_ms, null);
    assert.equal(updated.run_max_retries, 0);
    assert.equal(updated.active, false);

    const unauthorizedGet = await fetch(`${baseUrl}/cards/${created.id}`, {
      headers: authHeaders('user-b')
    });
    assert.equal(unauthorizedGet.status, 404);

    const deleteResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders('user-a')
    });
    assert.equal(deleteResponse.status, 204);

    const afterDeleteGet = await fetch(`${baseUrl}/cards/${created.id}`, {
      headers: authHeaders('user-a')
    });
    assert.equal(afterDeleteGet.status, 404);
  });

  resetRepositoryForTests();
});

test('cards API accepts youtube source type create and update', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'youtube',
        source_input: 'UCqzK60-oUOEq36uU9B1MMUg',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.source_type, 'youtube');

    const updateResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_input: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg'
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.source_input, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg');
  });

  resetRepositoryForTests();
});

test('cards API accepts smartcursor_link source type create and update', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'smartcursor_link',
        source_input: 'https://example.com/private-feed',
        params: {
          goal: 'Login and extract latest updates'
        },
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.source_type, 'smartcursor_link');

    const updateResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_input: 'https://example.com/private-dashboard'
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.source_input, 'https://example.com/private-dashboard');
  });

  resetRepositoryForTests();
});

test('cards API rejects rss_feed card creation when source check fails', async () => {
  setRepositoryForTests(createMemoryRepository());

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/rss/fetch') && options.method === 'POST') {
      return new Response('invalid feed', { status: 422 });
    }
    return originalFetch(url, options);
  };

  try {
    await withServer(async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/cards`, {
        method: 'POST',
        headers: authHeaders('user-a'),
        body: JSON.stringify({
          source_type: 'rss_feed',
          source_input: 'https://example.com/feed.xml',
          params: {
            genie_rss_api_key: 'test-key',
            genie_rss_base_url: baseUrl
          },
          schedule_enabled: false,
          active: true
        })
      });

      assert.equal(createResponse.status, 422);
      const body = await createResponse.json();
      assert.match(body.error, /RSS source check failed/i);
      assert.match(body.error, /invalid feed/i);
    });
  } finally {
    global.fetch = originalFetch;
    resetRepositoryForTests();
  }
});

test('cards API schedules all cards for stress test and skips already queued cards', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const firstCreateResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'stress-card-1',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(firstCreateResponse.status, 201);
    const firstCard = await firstCreateResponse.json();

    const secondCreateResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'stress-card-2',
        params: {},
        schedule_enabled: false,
        active: false
      })
    });
    assert.equal(secondCreateResponse.status, 201);
    const secondCard = await secondCreateResponse.json();

    const stressResponse = await fetch(`${baseUrl}/cards/stress-test/schedule`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(stressResponse.status, 202);
    assert.deepEqual(await stressResponse.json(), {
      total: 2,
      enqueued: 2,
      skipped: 0
    });

    const firstRunsResponse = await fetch(`${baseUrl}/cards/${firstCard.id}/runs`, {
      headers: authHeaders('user-a')
    });
    assert.equal(firstRunsResponse.status, 200);
    const firstRuns = await firstRunsResponse.json();
    assert.equal(firstRuns.length, 1);
    assert.equal(firstRuns[0].trigger_mode, 'scheduled');
    assert.equal(firstRuns[0].status, 'pending');

    const secondRunsResponse = await fetch(`${baseUrl}/cards/${secondCard.id}/runs`, {
      headers: authHeaders('user-a')
    });
    assert.equal(secondRunsResponse.status, 200);
    const secondRuns = await secondRunsResponse.json();
    assert.equal(secondRuns.length, 1);

    const repeatedStressResponse = await fetch(`${baseUrl}/cards/stress-test/schedule`, {
      method: 'POST',
      headers: authHeaders('user-a')
    });
    assert.equal(repeatedStressResponse.status, 202);
    assert.deepEqual(await repeatedStressResponse.json(), {
      total: 2,
      enqueued: 0,
      skipped: 2
    });
  });

  resetRepositoryForTests();
});

test('cards API bulk deactivates and deletes requested owner cards only', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const firstCreateResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'bulk-card-1',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(firstCreateResponse.status, 201);
    const firstCard = await firstCreateResponse.json();

    const secondCreateResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'bulk-card-2',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(secondCreateResponse.status, 201);
    const secondCard = await secondCreateResponse.json();

    const otherOwnerCreateResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-b'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'bulk-card-other-owner',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(otherOwnerCreateResponse.status, 201);
    const otherOwnerCard = await otherOwnerCreateResponse.json();

    const deactivateResponse = await fetch(`${baseUrl}/cards/bulk/deactivate`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ ids: [firstCard.id, otherOwnerCard.id] })
    });
    assert.equal(deactivateResponse.status, 200);
    assert.deepEqual(await deactivateResponse.json(), {
      requested: 2,
      updated: 1,
      skipped: 1
    });

    const updatedFirstResponse = await fetch(`${baseUrl}/cards/${firstCard.id}`, {
      headers: authHeaders('user-a')
    });
    const updatedFirst = await updatedFirstResponse.json();
    assert.equal(updatedFirst.active, false);

    const otherOwnerResponse = await fetch(`${baseUrl}/cards/${otherOwnerCard.id}`, {
      headers: authHeaders('user-b')
    });
    const otherOwner = await otherOwnerResponse.json();
    assert.equal(otherOwner.active, true);

    const deleteResponse = await fetch(`${baseUrl}/cards/bulk/delete`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ ids: [firstCard.id, secondCard.id, otherOwnerCard.id] })
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), {
      requested: 3,
      deleted: 2,
      skipped: 1
    });

    const userAListResponse = await fetch(`${baseUrl}/cards`, {
      headers: authHeaders('user-a')
    });
    assert.deepEqual(await userAListResponse.json(), []);

    const userBListResponse = await fetch(`${baseUrl}/cards`, {
      headers: authHeaders('user-b')
    });
    const userBCards = await userBListResponse.json();
    assert.equal(userBCards.length, 1);
    assert.equal(userBCards[0].id, otherOwnerCard.id);
  });

  resetRepositoryForTests();
});
