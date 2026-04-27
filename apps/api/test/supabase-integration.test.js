import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createApp } from '../src/app.js';
import { createSupabaseRepository } from '../src/repository/supabase-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';

const dbUrl = process.env.SUPABASE_DB_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const skipReason = !dbUrl || !supabaseUrl || !supabaseServiceRoleKey;

function makePgClient() {
  return new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

function safeName(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

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

async function refreshPostgrestSchema(client) {
  await client.query(`notify pgrst, 'reload schema'`);
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function waitForRepositoryReady(repository, { timeoutMs = 10000, intervalMs = 250 } = {}) {
  const start = Date.now();
  let lastError;

  while (Date.now() - start < timeoutMs) {
    try {
      await repository.listCards('readiness-check-user');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown readiness error');
  throw new Error(`supabase repository was not ready after ${timeoutMs}ms: ${message}`);
}

test('supabase migration applies in isolated schema and cleans up', { skip: skipReason }, async () => {
  const schema = safeName('migration_test');
  const client = makePgClient();
  await client.connect();

  try {
    await client.query(`create schema "${schema}"`);

    const migrationPaths = [
      new URL('../../../supabase/migrations/20260422_001_init_cards_runs.sql', import.meta.url),
      new URL('../../../supabase/migrations/20260426_001_enforce_one_active_run_per_card.sql', import.meta.url),
      new URL('../../../supabase/migrations/20260426_002_per_card_run_policy.sql', import.meta.url)
    ];

    for (const migrationPath of migrationPaths) {
      let sql = await readFile(migrationPath, 'utf8');
      sql = sql.replace(/create extension if not exists pgcrypto;\s*/i, '');
      sql = sql.replaceAll('public.', `"${schema}".`);
      await client.query(sql);
    }

    const exists = await client.query(
      `select to_regclass('"${schema}".cards') as cards, to_regclass('"${schema}".collection_runs') as runs, to_regclass('"${schema}".collected_data') as data`
    );

    assert.ok(exists.rows[0].cards);
    assert.ok(exists.rows[0].runs);
    assert.ok(exists.rows[0].data);
  } finally {
    await client.query(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});

test('cards CRUD API works against supabase temporary tables and cleans up', { skip: skipReason }, async () => {
  const cardsTable = safeName('cards_test');
  const runsTable = safeName('runs_test');
  const dataTable = safeName('data_test');

  const client = makePgClient();
  await client.connect();

  try {
    await client.query(`
      create table public."${cardsTable}" (
        id uuid primary key default gen_random_uuid(),
        owner_id text not null,
        source_type text not null,
        source_input text not null,
        params jsonb not null default '{}'::jsonb,
        schedule_enabled boolean not null default false,
        cron_expression text,
        timezone text not null default 'America/Chicago',
        next_run_at timestamptz,
        last_run_at timestamptz,
        run_timeout_ms integer,
        run_max_retries integer,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table public."${runsTable}" (
        id uuid primary key default gen_random_uuid(),
        card_id uuid not null references public."${cardsTable}"(id) on delete cascade,
        owner_id text not null,
        status text not null,
        trigger_mode text not null,
        attempts integer not null default 0,
        started_at timestamptz,
        ended_at timestamptz,
        error text,
        logs jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table public."${dataTable}" (
        id uuid primary key default gen_random_uuid(),
        run_id uuid not null references public."${runsTable}"(id) on delete cascade,
        owner_id text not null,
        raw_data jsonb,
        normalized_data jsonb,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await refreshPostgrestSchema(client);

    const repository = createSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      tables: {
        cards: cardsTable,
        collectionRuns: runsTable,
        collectedData: dataTable
      }
    });

    // CI can be slower to refresh PostgREST schema cache after temporary table creation.
    await waitForRepositoryReady(repository);
    setRepositoryForTests(repository);

    await withServer(async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/cards`, {
        method: 'POST',
        headers: authHeaders('user-a'),
        body: JSON.stringify({
          source_type: 'identifier_based',
          source_input: 'sensor-supabase-001',
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
      assert.equal(created.owner_id, 'user-a');
      assert.equal(created.run_timeout_ms, 45000);
      assert.equal(created.run_max_retries, 2);

      const listResponse = await fetch(`${baseUrl}/cards`, {
        headers: authHeaders('user-a')
      });
      assert.equal(listResponse.status, 200);
      const listed = await listResponse.json();
      assert.equal(listed.length, 1);

      const getResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
        headers: authHeaders('user-a')
      });
      assert.equal(getResponse.status, 200);

      const updateResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
        method: 'PATCH',
        headers: authHeaders('user-a'),
        body: JSON.stringify({
          source_input: 'sensor-supabase-updated',
          schedule_enabled: false,
          run_timeout_ms: null,
          run_max_retries: 0
        })
      });
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json();
      assert.equal(updated.source_input, 'sensor-supabase-updated');
      assert.equal(updated.schedule_enabled, false);
      assert.equal(updated.run_timeout_ms, null);
      assert.equal(updated.run_max_retries, 0);

      const deleteResponse = await fetch(`${baseUrl}/cards/${created.id}`, {
        method: 'DELETE',
        headers: authHeaders('user-a')
      });
      assert.equal(deleteResponse.status, 204);
    });

    const postDeleteCount = await client.query(`select count(*)::int as count from public."${cardsTable}"`);
    assert.equal(postDeleteCount.rows[0].count, 0);
  } finally {
    resetRepositoryForTests();
    await client.query(`drop table if exists public."${dataTable}" cascade`);
    await client.query(`drop table if exists public."${runsTable}" cascade`);
    await client.query(`drop table if exists public."${cardsTable}" cascade`);
    await refreshPostgrestSchema(client);
    await client.end();
  }
});
