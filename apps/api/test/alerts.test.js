import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { executeRun } from '../src/lib/run-engine.js';
import { config } from '../src/config.js';
import { flushDailyFailureAlerts, recordFailureAlert, _resetAlertsStateForTests } from '../src/services/alerts/index.js';

const ORIGINALS = {
  alertsEnabled: config.alertsEnabled,
  alertsSlackPrimary: config.alertsSlackPrimary,
  alertsSlackTimeoutMs: config.alertsSlackTimeoutMs,
  slackWebhookUrl: config.slackWebhookUrl,
  slackBotToken: config.slackBotToken,
  slackChannelId: config.slackChannelId
};

function resetAlertConfig() {
  config.alertsEnabled = ORIGINALS.alertsEnabled;
  config.alertsSlackPrimary = ORIGINALS.alertsSlackPrimary;
  config.alertsSlackTimeoutMs = ORIGINALS.alertsSlackTimeoutMs;
  config.slackWebhookUrl = ORIGINALS.slackWebhookUrl;
  config.slackBotToken = ORIGINALS.slackBotToken;
  config.slackChannelId = ORIGINALS.slackChannelId;
  _resetAlertsStateForTests();
}

test('alerts: daily digest sends only for prior day failures', async () => {
  config.alertsEnabled = true;
  config.alertsSlackPrimary = 'webhook';
  config.slackWebhookUrl = 'https://hooks.slack.test/services/abc';
  config.slackBotToken = '';
  config.slackChannelId = '';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('ok', { status: 200 });
  };

  try {
    recordFailureAlert({
      type: 'run_failed',
      run: { id: 'run-1' },
      error: { message: 'boom' },
      context: { timestamp: '2026-05-10T23:00:00.000Z' }
    });

    await flushDailyFailureAlerts({ now: new Date('2026-05-11T00:01:00.000Z') });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://hooks.slack.test/services/abc');
  } finally {
    global.fetch = originalFetch;
    resetAlertConfig();
  }
});

test('alerts: no failures means no digest message', async () => {
  config.alertsEnabled = true;
  config.alertsSlackPrimary = 'webhook';
  config.slackWebhookUrl = 'https://hooks.slack.test/services/abc';

  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return new Response('ok', { status: 200 });
  };

  try {
    await flushDailyFailureAlerts({ now: new Date('2026-05-11T00:01:00.000Z') });
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    resetAlertConfig();
  }
});

test('alerts: falls back to bot transport when webhook fails during digest send', async () => {
  config.alertsEnabled = true;
  config.alertsSlackPrimary = 'webhook';
  config.slackWebhookUrl = 'https://hooks.slack.test/services/abc';
  config.slackBotToken = 'xoxb-test-token';
  config.slackChannelId = 'C123456';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('hooks.slack')) {
      return new Response('bad', { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    recordFailureAlert({
      type: 'run_failed',
      run: { id: 'run-1' },
      error: { message: 'boom' },
      context: { timestamp: '2026-05-10T22:30:00.000Z' }
    });

    await flushDailyFailureAlerts({ now: new Date('2026-05-11T00:01:00.000Z') });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'https://hooks.slack.test/services/abc');
    assert.equal(calls[1], 'https://slack.com/api/chat.postMessage');
  } finally {
    global.fetch = originalFetch;
    resetAlertConfig();
  }
});

test('run-engine: failed run is queued and flushed next day as digest', async () => {
  config.alertsEnabled = true;
  config.alertsSlackPrimary = 'webhook';
  config.slackWebhookUrl = 'https://hooks.slack.test/services/abc';
  config.slackBotToken = '';
  config.slackChannelId = '';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('hooks.slack')) {
      return new Response('ok', { status: 200 });
    }
    throw new Error('forced collector fetch failure');
  };

  try {
    const repository = createMemoryRepository();
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'http_api',
      source_input: 'https://example.com/fail',
      params: {},
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
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });

    assert.equal(run.status, 'failed');
    const preFlushSlackCalls = calls.filter((url) => url.includes('hooks.slack')).length;
    assert.equal(preFlushSlackCalls, 0);

    await flushDailyFailureAlerts({ now: new Date('2100-01-02T00:00:00.000Z') });
    const postFlushSlackCalls = calls.filter((url) => url.includes('hooks.slack')).length;
    assert.equal(postFlushSlackCalls, 1);
  } finally {
    global.fetch = originalFetch;
    resetAlertConfig();
  }
});

test('run-engine: successful run does not produce digest traffic', async () => {
  config.alertsEnabled = true;
  config.alertsSlackPrimary = 'webhook';
  config.slackWebhookUrl = 'https://hooks.slack.test/services/abc';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('hooks.slack')) {
      return new Response('ok', { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const repository = createMemoryRepository();
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'http_api',
      source_input: 'https://example.com/success',
      params: {},
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
      timeoutMs: config.runTimeoutMs,
      maxRetries: config.runMaxRetries
    });
    assert.equal(run.status, 'success');

    await flushDailyFailureAlerts({ now: new Date('2100-01-02T00:00:00.000Z') });
    const slackCalls = calls.filter((url) => url.includes('hooks.slack'));
    assert.equal(slackCalls.length, 0);
  } finally {
    global.fetch = originalFetch;
    resetAlertConfig();
  }
});

