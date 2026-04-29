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
