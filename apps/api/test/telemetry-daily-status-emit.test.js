import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_STATUS, TRIGGER_MODE } from '@ragingester/shared';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';
import {
  flushAllDailyStatuses,
  flushRssDailyStatus,
  recordStatusEvent,
  _resetDailyStatusFlushStateForTests,
  _resetLocalStatusLogForTests,
  _resetTelemetryMetricsForTests,
  getTelemetryMetrics
} from '../src/telemetry/index.js';

const OWNER = 'telemetry-emit-owner';

const ORIGINALS = {
  telemetryDailyStatusEnabled: config.telemetryDailyStatusEnabled,
  telemetryStatusYoutubeEnabled: config.telemetryStatusYoutubeEnabled,
  telemetryStatusLinkedinEnabled: config.telemetryStatusLinkedinEnabled,
  telemetryStatusSlackChannelId: config.telemetryStatusSlackChannelId,
  telemetryStatusSlackWebhookUrl: config.telemetryStatusSlackWebhookUrl,
  slackBotToken: config.slackBotToken,
  telemetrySlackTimeoutMs: config.telemetrySlackTimeoutMs
};

function resetTelemetryConfig() {
  config.telemetryDailyStatusEnabled = ORIGINALS.telemetryDailyStatusEnabled;
  config.telemetryStatusYoutubeEnabled = ORIGINALS.telemetryStatusYoutubeEnabled;
  config.telemetryStatusLinkedinEnabled = ORIGINALS.telemetryStatusLinkedinEnabled;
  config.telemetryStatusSlackChannelId = ORIGINALS.telemetryStatusSlackChannelId;
  config.telemetryStatusSlackWebhookUrl = ORIGINALS.telemetryStatusSlackWebhookUrl;
  config.slackBotToken = ORIGINALS.slackBotToken;
  config.telemetrySlackTimeoutMs = ORIGINALS.telemetrySlackTimeoutMs;
  _resetDailyStatusFlushStateForTests();
  _resetTelemetryMetricsForTests();
  _resetLocalStatusLogForTests();
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

function authHeaders(userId = OWNER) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId
  };
}

async function seedFailedYesterday(repository, date) {
  const card = await repository.createCard({
    owner_id: OWNER,
    source_type: 'rss_feed',
    source_input: 'https://emit.example/feed.xml',
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

  const run = await repository.createRun({
    card_id: card.id,
    owner_id: OWNER,
    status: RUN_STATUS.FAILED,
    trigger_mode: TRIGGER_MODE.SCHEDULED,
    attempts: 1,
    started_at: `${date}T12:00:00.000Z`,
    ended_at: `${date}T12:00:00.000Z`,
    error: 'run timed out after 30000ms',
    error_payload: { name: 'Error', message: 'run timed out after 30000ms' },
    logs: [],
    created_at: `${date}T12:00:00.000Z`
  });
  recordStatusEvent({
    runId: run.id,
    cardId: card.id,
    sourceType: card.source_type,
    sourceInput: card.source_input,
    status: RUN_STATUS.FAILED,
    endedAt: run.ended_at,
    error: run.error
  });

  return card;
}

test('flushRssDailyStatus: flag off skips and does not call fetch', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = false;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';

  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return new Response('ok', { status: 200 });
  };

  try {
    const repository = createMemoryRepository();
    const result = await flushRssDailyStatus({
      repository,
      now: new Date('2026-07-27T01:00:00.000Z')
    });
    assert.equal(result.posted, false);
    assert.equal(result.skippedReason, 'disabled');
    assert.equal(result.date, '2026-07-26');
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('flushRssDailyStatus: webhook posts blocks then JSON; second flush skips', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('ok', { status: 200 });
  };

  try {
    const repository = createMemoryRepository();
    await seedFailedYesterday(repository, '2026-07-26');
    const now = new Date('2026-07-27T01:00:00.000Z');

    const first = await flushRssDailyStatus({ repository, now });
    assert.equal(first.posted, true);
    assert.equal(first.date, '2026-07-26');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://hooks.slack.test/services/status');
    assert.ok(Array.isArray(calls[0].body.blocks));
    assert.match(calls[0].body.text, /RSS Daily Status, 2026-07-26/);
    assert.match(JSON.stringify(calls[0].body.blocks), /emit\.example\/feed\.xml/);
    assert.match(calls[1].body.text, /```json/);
    assert.match(calls[1].body.text, /genie_rss:2026-07-26/);

    const second = await flushRssDailyStatus({ repository, now });
    assert.equal(second.posted, false);
    assert.equal(second.skippedReason, 'already_posted');
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('flushRssDailyStatus: bot posts parent then thread with thread_ts', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = '';
  config.slackBotToken = 'xoxb-test';
  config.telemetryStatusSlackChannelId = 'C-STATUS';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ ok: true, ts: '111.222' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true, ts: '111.333' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const repository = createMemoryRepository();
    await seedFailedYesterday(repository, '2026-07-26');

    const result = await flushRssDailyStatus({
      repository,
      now: new Date('2026-07-27T01:00:00.000Z')
    });
    assert.equal(result.posted, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
    assert.equal(calls[0].body.channel, 'C-STATUS');
    assert.ok(Array.isArray(calls[0].body.blocks));
    assert.equal(calls[1].body.thread_ts, '111.222');
    assert.match(calls[1].body.text, /```json/);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('flushRssDailyStatus: delivery failure does not mark posted; retry succeeds', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  let attempt = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return new Response('nope', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  };

  try {
    const repository = createMemoryRepository();
    await seedFailedYesterday(repository, '2026-07-26');
    const now = new Date('2026-07-27T01:00:00.000Z');

    const failed = await flushRssDailyStatus({ repository, now });
    assert.equal(failed.posted, false);
    assert.equal(failed.skippedReason, 'delivery_failed');

    const retried = await flushRssDailyStatus({ repository, now });
    assert.equal(retried.posted, true);
    assert.equal(attempt, 3);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('POST /telemetry/rss-daily-status/emit: flag off returns 503', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = false;
  setRepositoryForTests(createMemoryRepository());

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telemetry/rss-daily-status/emit?date=2026-07-26`, {
        method: 'POST',
        headers: authHeaders()
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /disabled/);
    });
  } finally {
    resetRepositoryForTests();
    resetTelemetryConfig();
  }
});

test('POST /telemetry/rss-daily-status/emit: flag on posts to Slack', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  const repository = createMemoryRepository();
  setRepositoryForTests(repository);
  await seedFailedYesterday(repository, '2026-07-26');

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlText = String(url);
    if (urlText.includes('hooks.slack.test')) {
      calls.push({ url: urlText, body: JSON.parse(init.body) });
      return new Response('ok', { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telemetry/rss-daily-status/emit?date=2026-07-26`, {
        method: 'POST',
        headers: authHeaders()
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.posted, true);
      assert.equal(body.date, '2026-07-26');
      assert.equal(body.status.system, 'genie_rss');
      assert.equal(calls.length, 2);
      assert.ok(Array.isArray(calls[0].body.blocks));
    });
  } finally {
    global.fetch = originalFetch;
    resetRepositoryForTests();
    resetTelemetryConfig();
  }
});

test('durable idempotency: recordDailyStatusPost then flush skips', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return new Response('ok', { status: 200 });
  };

  try {
    const repository = createMemoryRepository();
    await seedFailedYesterday(repository, '2026-07-26');
    await repository.recordDailyStatusPost({
      system: 'genie_rss',
      date: '2026-07-26',
      run_id: 'genie_rss:2026-07-26'
    });
    _resetDailyStatusFlushStateForTests();

    const result = await flushRssDailyStatus({
      repository,
      now: new Date('2026-07-27T01:00:00.000Z')
    });
    assert.equal(result.posted, false);
    assert.equal(result.skippedReason, 'already_posted');
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('flushAllDailyStatuses posts youtube and linkedin when enabled', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusYoutubeEnabled = true;
  config.telemetryStatusLinkedinEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('ok', { status: 200 });
  };

  try {
    const repository = createMemoryRepository();
    await seedFailedYesterday(repository, '2026-07-26');
    await repository.createCard({
      owner_id: OWNER,
      source_type: 'youtube',
      source_input: 'UCyt',
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
    await repository.createCard({
      owner_id: OWNER,
      source_type: 'linkedin',
      source_input: 'https://www.linkedin.com/in/test',
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

    const { results } = await flushAllDailyStatuses({
      repository,
      now: new Date('2026-07-27T01:00:00.000Z')
    });
    assert.equal(results.length, 3);
    assert.ok(results.every((row) => row.posted === true));
    assert.deepEqual(
      results.map((row) => row.system).sort(),
      ['genie_linkedin', 'genie_rss', 'genie_youtube']
    );
    // 3 systems × (blocks + json) = 6 webhook posts
    assert.equal(calls.length, 6);
    assert.equal(getTelemetryMetrics().status_posted, 3);
  } finally {
    global.fetch = originalFetch;
    resetTelemetryConfig();
  }
});

test('POST /telemetry/daily-status/emit?system=genie_youtube posts YouTube card', async () => {
  resetTelemetryConfig();
  config.telemetryDailyStatusEnabled = true;
  config.telemetryStatusSlackWebhookUrl = 'https://hooks.slack.test/services/status';
  config.slackBotToken = '';
  config.telemetryStatusSlackChannelId = '';

  const repository = createMemoryRepository();
  setRepositoryForTests(repository);
  await repository.createCard({
    owner_id: OWNER,
    source_type: 'youtube',
    source_input: 'UCemit',
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

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlText = String(url);
    if (urlText.includes('hooks.slack.test')) {
      calls.push({ url: urlText, body: JSON.parse(init.body) });
      return new Response('ok', { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/telemetry/daily-status/emit?system=genie_youtube&date=2026-07-26`,
        { method: 'POST', headers: authHeaders() }
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.posted, true);
      assert.equal(body.system, 'genie_youtube');
      assert.match(calls[0].body.text, /YouTube Daily Status/);
    });
  } finally {
    global.fetch = originalFetch;
    resetRepositoryForTests();
    resetTelemetryConfig();
  }
});

test('GET /telemetry/metrics returns counters', async () => {
  resetTelemetryConfig();
  setRepositoryForTests(createMemoryRepository());

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telemetry/metrics`, {
        headers: authHeaders()
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(typeof body.status_posted, 'number');
      assert.equal(typeof body.pipeline_error_posted, 'number');
    });
  } finally {
    resetRepositoryForTests();
    resetTelemetryConfig();
  }
});
