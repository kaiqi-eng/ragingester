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

function headersWithUser(userId) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId
  };
}

function headersWithBearer(token, userId) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-user-id': userId
  };
}

test('auth middleware uses bearer identity first and x-user-id/dev fallback', async () => {
  setRepositoryForTests(createMemoryRepository());

  await withServer(async (baseUrl) => {
    const bearerCreate = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: headersWithBearer('google-oauth-access-token-123', 'user-x'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'auth-bearer-001',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(bearerCreate.status, 201);
    const bearerCard = await bearerCreate.json();
    assert.equal(bearerCard.owner_id, 'token:google-oauth-acc');

    const userCreate = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: headersWithUser('user-a'),
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'auth-user-001',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(userCreate.status, 201);
    const userCard = await userCreate.json();
    assert.equal(userCard.owner_id, 'user-a');

    const defaultCreate = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source_type: 'identifier_based',
        source_input: 'auth-default-001',
        params: {},
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(defaultCreate.status, 201);
    const defaultCard = await defaultCreate.json();
    assert.equal(defaultCard.owner_id, 'dev-user-1');

    const bearerList = await fetch(`${baseUrl}/cards`, {
      headers: headersWithBearer('google-oauth-access-token-123', 'ignored-user')
    });
    assert.equal(bearerList.status, 200);
    const bearerRows = await bearerList.json();
    assert.equal(bearerRows.length, 1);
    assert.equal(bearerRows[0].source_input, 'auth-bearer-001');

    const userList = await fetch(`${baseUrl}/cards`, {
      headers: headersWithUser('user-a')
    });
    assert.equal(userList.status, 200);
    const userRows = await userList.json();
    assert.equal(userRows.length, 1);
    assert.equal(userRows[0].source_input, 'auth-user-001');
  });

  resetRepositoryForTests();
});
