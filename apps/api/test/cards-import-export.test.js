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

function authHeaders(userId, contentType = 'application/json') {
  return {
    'content-type': contentType,
    'x-user-id': userId
  };
}

test('cards can be exported as csv', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createOne = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'sensor-1',
        params: { job_name: 'Sensor One' },
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createOne.status, 201);

    const exportResponse = await fetch(`${baseUrl}/cards/export.csv`, {
      headers: authHeaders('user-a')
    });
    assert.equal(exportResponse.status, 200);
    const csv = await exportResponse.text();
    assert.match(csv, /source_type,source_input,schedule_enabled/);
    assert.match(csv, /identifier_based,sensor-1/);
  });

  resetRepositoryForTests();
});

test('csv import skips duplicate cards by source_type and source_input', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const createExisting = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'duplicate-source',
        params: { job_name: 'Existing' },
        schedule_enabled: false,
        active: true
      })
    });
    assert.equal(createExisting.status, 201);

    const csv = [
      'source_type,source_input,schedule_enabled,cron_expression,timezone,active,run_timeout_ms,run_max_retries,params',
      'identifier_based,duplicate-source,false,,,true,,,"{""job_name"":""Dup""}"',
      'identifier_based,new-source,false,,,true,,,"{""job_name"":""New""}"'
    ].join('\n');

    const importResponse = await fetch(`${baseUrl}/cards/import.csv`, {
      method: 'POST',
      headers: authHeaders('user-a', 'text/csv'),
      body: csv
    });
    assert.equal(importResponse.status, 200);
    const result = await importResponse.json();
    assert.equal(result.total_rows, 2);
    assert.equal(result.created, 1);
    assert.equal(result.skipped_duplicates, 1);
    assert.equal(result.errors.length, 0);

    const listResponse = await fetch(`${baseUrl}/cards`, { headers: authHeaders('user-a') });
    assert.equal(listResponse.status, 200);
    const cards = await listResponse.json();
    assert.equal(cards.length, 2);
  });

  resetRepositoryForTests();
});
