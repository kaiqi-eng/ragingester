import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_STATUS, TRIGGER_MODE } from '@ragingester/shared';
import { createApp } from '../src/app.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';
import {
  buildDailyRunId,
  buildDailyStatus,
  buildRssDailyStatus,
  recordStatusEvent,
  validateRssDailyStatus,
  _resetLocalStatusLogForTests
} from '../src/telemetry/index.js';


const DAY = '2026-07-26';
const OWNER = 'telemetry-owner';

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

function authHeaders(userId = OWNER) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId
  };
}

async function seedCard(repository, { source_input, active = true }) {
  return repository.createCard({
    owner_id: OWNER,
    source_type: 'rss_feed',
    source_input,
    params: {},
    schedule_enabled: false,
    cron_expression: null,
    timezone: 'UTC',
    next_run_at: null,
    last_run_at: null,
    run_timeout_ms: null,
    run_max_retries: null,
    active
  });
}

async function seedRun(repository, card, {
  status,
  ended_at,
  error = null,
  created_at = ended_at
}) {
  return repository.createRun({
    card_id: card.id,
    owner_id: OWNER,
    status,
    trigger_mode: TRIGGER_MODE.SCHEDULED,
    attempts: 1,
    started_at: ended_at,
    ended_at: status === RUN_STATUS.RUNNING ? null : ended_at,
    error,
    error_payload: error ? { name: 'Error', message: error } : null,
    logs: [],
    created_at
  });
}

function recordTerminal(card, run, metrics = {}) {
  recordStatusEvent({
    runId: run.id,
    cardId: card.id,
    sourceType: card.source_type,
    sourceInput: card.source_input,
    status: run.status,
    endedAt: run.ended_at,
    metrics,
    error: run.error
  });
}

test('buildRssDailyStatus: classifies ok, degraded, failed; ignores running; groups failures', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();

  const okCard = await seedCard(repository, { source_input: 'https://ok.example/feed.xml' });
  const degradedCard = await seedCard(repository, { source_input: 'https://degraded.example/feed.xml' });
  const failedCard = await seedCard(repository, { source_input: 'https://failed.example/feed.xml' });
  const inactiveCard = await seedCard(repository, {
    source_input: 'https://inactive.example/feed.xml',
    active: false
  });

  const okRun = await seedRun(repository, okCard, {
    status: RUN_STATUS.SUCCESS,
    ended_at: '2026-07-26T10:00:00.000Z'
  });
  await repository.createCollectedData({
    run_id: okRun.id,
    owner_id: OWNER,
    raw_data: {},
    normalized_data: {},
    metadata: {
      metrics: { fetched: 5, selected: 4, ingested: 4, failed: 0 },
      source_type: 'rss_feed'
    }
  });
  recordTerminal(okCard, okRun, { fetched: 5, selected: 4, ingested: 4, failed: 0 });

  const degradedRun = await seedRun(repository, degradedCard, {
    status: RUN_STATUS.SUCCESS,
    ended_at: '2026-07-26T12:00:00.000Z'
  });
  await repository.createCollectedData({
    run_id: degradedRun.id,
    owner_id: OWNER,
    raw_data: {},
    normalized_data: {},
    metadata: {
      metrics: { fetched: 5, selected: 4, ingested: 2, failed: 2 },
      source_type: 'rss_feed'
    }
  });
  recordTerminal(degradedCard, degradedRun, { fetched: 5, selected: 4, ingested: 2, failed: 2 });

  const failedRunOne = await seedRun(repository, failedCard, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-26T08:00:00.000Z',
    error: 'run timed out after 30000ms'
  });
  recordTerminal(failedCard, failedRunOne);
  const failedRunTwo = await seedRun(repository, failedCard, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-26T09:00:00.000Z',
    error: 'run timed out after 30000ms'
  });
  recordTerminal(failedCard, failedRunTwo);

  await seedRun(repository, okCard, {
    status: RUN_STATUS.RUNNING,
    ended_at: '2026-07-26T11:00:00.000Z'
  });

  // Outside window — ignored
  const earlyRun = await seedRun(repository, okCard, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-25T23:59:59.000Z',
    error: 'too early'
  });
  recordTerminal(okCard, earlyRun);

  // Unrecorded inactive-card run is ignored by the local status log
  await seedRun(repository, inactiveCard, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-26T15:00:00.000Z',
    error: 'inactive'
  });

  const status = await buildRssDailyStatus({ repository, date: DAY });
  validateRssDailyStatus(status);

  assert.equal(status.system, 'genie_rss');
  assert.equal(status.date, DAY);
  assert.equal(status.run_id, buildDailyRunId(DAY));
  assert.equal(status.link, buildDailyRunId(DAY));
  assert.equal(status.feeds_active, 3);
  assert.deepEqual(status.ingest, { ok: 1, degraded: 1, failed: 2 });
  assert.deepEqual(status.items, { fetched: 10, selected: 8, ingested: 6, failed: 2 });
  assert.equal(status.last_run, '2026-07-26T12:00:00.000Z');
  assert.equal(status.failures.length, 1);
  assert.deepEqual(status.failures[0], {
    feed: 'https://failed.example/feed.xml',
    code: 'run timed out after 30000ms',
    count: 2,
    first_seen: '2026-07-26T08:00:00.000Z'
  });
});

test('buildRssDailyStatus: empty day still validates', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  await seedCard(repository, { source_input: 'https://idle.example/feed.xml' });

  const status = await buildRssDailyStatus({ repository, date: DAY });
  validateRssDailyStatus(status);
  assert.equal(status.feeds_active, 0);
  assert.deepEqual(status.ingest, { ok: 0, degraded: 0, failed: 0 });
  assert.deepEqual(status.items, { fetched: 0, selected: 0, ingested: 0, failed: 0 });
  assert.deepEqual(status.failures, []);
  assert.equal(status.last_run, '2026-07-26T00:00:00.000Z');
});

test('buildRssDailyStatus: idle active cards are excluded from feeds_active', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  const ran = await seedCard(repository, { source_input: 'https://ran.example/feed.xml' });
  await seedCard(repository, { source_input: 'https://idle.example/feed.xml' });
  const run = await seedRun(repository, ran, {
    status: RUN_STATUS.SUCCESS,
    ended_at: '2026-07-26T10:00:00.000Z'
  });
  recordTerminal(ran, run);

  const status = await buildRssDailyStatus({ repository, date: DAY });
  assert.equal(status.feeds_active, 1);
  assert.deepEqual(status.ingest, { ok: 1, degraded: 0, failed: 0 });
});

test('GET /telemetry/rss-daily-status returns schema-valid JSON', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  setRepositoryForTests(repository);

  const card = await seedCard(repository, { source_input: 'https://http.example/feed.xml' });
  const run = await seedRun(repository, card, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-26T14:00:00.000Z',
    error: 'boom'
  });
  recordTerminal(card, run);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telemetry/rss-daily-status?date=${DAY}`, {
        headers: authHeaders()
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      validateRssDailyStatus(body);
      assert.equal(body.ingest.failed, 1);
      assert.equal(body.failures[0].code, 'boom');
    });
  } finally {
    resetRepositoryForTests();
  }
});

test('GET /telemetry/rss-daily-status rejects bad date', async () => {
  _resetLocalStatusLogForTests();
  setRepositoryForTests(createMemoryRepository());

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telemetry/rss-daily-status?date=07-26-2026`, {
        headers: authHeaders()
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(body.error, /YYYY-MM-DD/);
    });
  } finally {
    resetRepositoryForTests();
  }
});

test('buildDailyStatus: youtube system classifies failures', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  const card = await repository.createCard({
    owner_id: OWNER,
    source_type: 'youtube',
    source_input: 'https://www.youtube.com/channel/UCtest',
    params: {},
    schedule_enabled: false,
    cron_expression: null,
    timezone: 'UTC',
    next_run_at: null,
    last_run_at: null,
    run_timeout_ms: null,
    run_max_retries: null,
    active: true
  });
  await seedRun(repository, card, {
    status: RUN_STATUS.FAILED,
    ended_at: '2026-07-26T10:00:00.000Z',
    error: 'GENIE_RSS_API_KEY is required for youtube ingestion'
  }).then((run) => recordTerminal(card, run));

  const status = await buildDailyStatus({
    repository,
    date: DAY,
    system: 'genie_youtube'
  });
  validateRssDailyStatus(status);
  assert.equal(status.system, 'genie_youtube');
  assert.equal(status.run_id, 'genie_youtube:2026-07-26');
  assert.equal(status.feeds_active, 1);
  assert.deepEqual(status.ingest, { ok: 0, degraded: 0, failed: 1 });
  assert.equal(status.failures[0].feed, 'https://www.youtube.com/channel/UCtest');
});

test('buildDailyStatus: linkedin system empty day validates', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  await repository.createCard({
    owner_id: OWNER,
    source_type: 'linkedin',
    source_input: 'https://www.linkedin.com/in/example',
    params: {},
    schedule_enabled: false,
    cron_expression: null,
    timezone: 'UTC',
    next_run_at: null,
    last_run_at: null,
    run_timeout_ms: null,
    run_max_retries: null,
    active: true
  });

  const status = await buildDailyStatus({
    repository,
    date: DAY,
    system: 'genie_linkedin'
  });
  validateRssDailyStatus(status);
  assert.equal(status.system, 'genie_linkedin');
  assert.equal(status.feeds_active, 0);
  assert.deepEqual(status.ingest, { ok: 0, degraded: 0, failed: 0 });
});

test('GET /telemetry/daily-status?system=genie_youtube returns youtube status', async () => {
  _resetLocalStatusLogForTests();
  const repository = createMemoryRepository();
  setRepositoryForTests(repository);
  const card = await repository.createCard({
    owner_id: OWNER,
    source_type: 'youtube',
    source_input: 'UChttp',
    params: {},
    schedule_enabled: false,
    cron_expression: null,
    timezone: 'UTC',
    next_run_at: null,
    last_run_at: null,
    run_timeout_ms: null,
    run_max_retries: null,
    active: true
  });
  const run = await seedRun(repository, card, {
    status: RUN_STATUS.SUCCESS,
    ended_at: '2026-07-26T10:00:00.000Z'
  });
  recordTerminal(card, run);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/telemetry/daily-status?system=genie_youtube&date=${DAY}`,
        { headers: authHeaders() }
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      validateRssDailyStatus(body);
      assert.equal(body.system, 'genie_youtube');
      assert.equal(body.feeds_active, 1);
    });
  } finally {
    resetRepositoryForTests();
  }
});
