import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { executeRun } from '../src/lib/run-engine.js';
import { config } from '../src/config.js';
import {
  PIPELINE_ERROR_CLASSES,
  autoActionForClass,
  buildDailyRunId,
  buildPipelineErrorBlocks,
  classifyErrorClass,
  emitRssPipelineError,
  formatPipelineErrorTime,
  pipelineErrorFallbackText
} from '../src/telemetry/index.js';

const ORIGINALS = {
  telemetryPipelineErrorsEnabled: config.telemetryPipelineErrorsEnabled,
  telemetryPipelineErrorsSlackChannelId: config.telemetryPipelineErrorsSlackChannelId,
  telemetryPipelineErrorsSlackWebhookUrl: config.telemetryPipelineErrorsSlackWebhookUrl,
  telemetryPipelineErrorsMention: config.telemetryPipelineErrorsMention,
  slackBotToken: config.slackBotToken,
  alertsSlackTimeoutMs: config.alertsSlackTimeoutMs
};

function resetPipelineConfig() {
  config.telemetryPipelineErrorsEnabled = ORIGINALS.telemetryPipelineErrorsEnabled;
  config.telemetryPipelineErrorsSlackChannelId = ORIGINALS.telemetryPipelineErrorsSlackChannelId;
  config.telemetryPipelineErrorsSlackWebhookUrl = ORIGINALS.telemetryPipelineErrorsSlackWebhookUrl;
  config.telemetryPipelineErrorsMention = ORIGINALS.telemetryPipelineErrorsMention;
  config.slackBotToken = ORIGINALS.slackBotToken;
  config.alertsSlackTimeoutMs = ORIGINALS.alertsSlackTimeoutMs;
}

test('classifyErrorClass maps known failure patterns', () => {
  assert.equal(
    classifyErrorClass({ message: 'run timed out after 30000ms' }),
    PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT
  );
  assert.equal(
    classifyErrorClass({ message: 'GENIE_RSS_API_KEY is required for rss_feed ingestion' }),
    PIPELINE_ERROR_CLASSES.CONFIG_AUTH
  );
  assert.equal(
    classifyErrorClass({ message: 'billing quota exceeded' }),
    PIPELINE_ERROR_CLASSES.BILLING_QUOTA
  );
  assert.equal(
    classifyErrorClass({ message: 'zod validation failed for params' }),
    PIPELINE_ERROR_CLASSES.SCHEMA_VALIDATION
  );
  assert.equal(
    classifyErrorClass({ message: 'something odd happened' }),
    PIPELINE_ERROR_CLASSES.UNKNOWN
  );
});

test('autoActionForClass returns guidance for each class', () => {
  for (const errorClass of Object.values(PIPELINE_ERROR_CLASSES)) {
    const action = autoActionForClass(errorClass);
    assert.equal(typeof action, 'string');
    assert.ok(action.length > 0);
  }
});

test('buildPipelineErrorBlocks includes Bays-shaped fields and execution id', () => {
  const payload = {
    workflow: 'Genie_RSS',
    failedNode: 'https://techcrunch.com/feed/',
    errorClass: PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT,
    error: 'run timed out after 30000ms',
    executionId: 'genie_rss:2026-07-26',
    time: 'Sun, 26 Jul 2026, 12:00PM UTC',
    autoAction: autoActionForClass(PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT),
    mention: '<@U123>'
  };

  const { blocks } = buildPipelineErrorBlocks(payload);
  assert.equal(blocks[0].type, 'header');
  assert.equal(blocks[0].text.text, 'Bays — Pipeline Failure');
  assert.match(blocks[1].text.text, /\*Workflow:\* Genie_RSS/);
  assert.match(blocks[1].text.text, /\*Failed Node:\* https:\/\/techcrunch\.com\/feed\//);
  assert.match(blocks[1].text.text, /\*Error Class:\* NETWORK\/TIMEOUT/);
  assert.match(blocks[1].text.text, /\*Execution ID:\* genie_rss:2026-07-26/);
  assert.equal(blocks[2].type, 'context');
  assert.match(blocks[2].elements[0].text, /@U123/);

  const text = pipelineErrorFallbackText(payload);
  assert.match(text, /Bays — Pipeline Failure/);
  assert.match(text, /Execution ID: genie_rss:2026-07-26/);
});

test('formatPipelineErrorTime renders UTC human time', () => {
  assert.equal(
    formatPipelineErrorTime('2026-07-23T14:01:00.000Z'),
    'Thu, 23 Jul 2026, 2:01PM UTC'
  );
});

test('emitRssPipelineError: flag off skips fetch', async () => {
  resetPipelineConfig();
  config.telemetryPipelineErrorsEnabled = false;
  config.telemetryPipelineErrorsSlackWebhookUrl = 'https://hooks.slack.test/pipeline';

  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return new Response('ok', { status: 200 });
  };

  try {
    const result = await emitRssPipelineError({
      card: { source_type: 'rss_feed', source_input: 'https://example.com/feed.xml' },
      run: { id: 'run-1' },
      error: { message: 'boom' },
      timestamp: '2026-07-26T12:00:00.000Z'
    });
    assert.equal(result.posted, false);
    assert.equal(result.skippedReason, 'disabled');
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    resetPipelineConfig();
  }
});

test('emitRssPipelineError: webhook posts blocks with feed URL', async () => {
  resetPipelineConfig();
  config.telemetryPipelineErrorsEnabled = true;
  config.telemetryPipelineErrorsSlackWebhookUrl = 'https://hooks.slack.test/pipeline';
  config.slackBotToken = '';
  config.telemetryPipelineErrorsSlackChannelId = '';
  config.telemetryPipelineErrorsMention = '<@U999>';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('ok', { status: 200 });
  };

  try {
    const result = await emitRssPipelineError({
      card: { source_type: 'rss_feed', source_input: 'https://emit.example/feed.xml' },
      run: { id: 'run-42' },
      error: { name: 'Error', message: 'run timed out after 30000ms' },
      timestamp: '2026-07-26T12:00:00.000Z'
    });

    assert.equal(result.posted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://hooks.slack.test/pipeline');
    assert.ok(Array.isArray(calls[0].body.blocks));
    assert.match(calls[0].body.text, /Bays — Pipeline Failure/);
    assert.match(JSON.stringify(calls[0].body.blocks), /emit\.example\/feed\.xml/);
    assert.match(JSON.stringify(calls[0].body.blocks), /genie_rss:2026-07-26/);
    assert.equal(result.payload.executionId, buildDailyRunId('2026-07-26'));
    assert.equal(result.payload.errorClass, PIPELINE_ERROR_CLASSES.NETWORK_TIMEOUT);
  } finally {
    global.fetch = originalFetch;
    resetPipelineConfig();
  }
});

test('run-engine: terminal rss_feed failure posts pipeline error when enabled', async () => {
  resetPipelineConfig();
  config.telemetryPipelineErrorsEnabled = true;
  config.telemetryPipelineErrorsSlackWebhookUrl = 'https://hooks.slack.test/pipeline';
  config.slackBotToken = '';
  config.telemetryPipelineErrorsSlackChannelId = '';
  const previousGenieKey = config.genieRssApiKey;
  config.genieRssApiKey = '';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlText = String(url);
    if (urlText.includes('hooks.slack.test/pipeline')) {
      calls.push({ url: urlText, body: JSON.parse(init.body) });
      return new Response('ok', { status: 200 });
    }
    throw new Error('forced collector fetch failure');
  };

  try {
    const repository = createMemoryRepository();
    const card = await repository.createCard({
      owner_id: 'user-a',
      source_type: 'rss_feed',
      source_input: 'https://fail.example/feed.xml',
      params: {},
      run_timeout_ms: 30000,
      run_max_retries: 0,
      schedule_enabled: false,
      cron_expression: null,
      timezone: 'UTC',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      timeoutMs: 30000,
      maxRetries: 0
    });

    assert.equal(run.status, 'failed');
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.text, /Bays — Pipeline Failure/);
    assert.match(JSON.stringify(calls[0].body.blocks), /fail\.example\/feed\.xml/);
    assert.match(JSON.stringify(calls[0].body.blocks), /CONFIG\/AUTH/);
  } finally {
    global.fetch = originalFetch;
    config.genieRssApiKey = previousGenieKey;
    resetPipelineConfig();
  }
});

test('run-engine: non-rss failure does not post pipeline error', async () => {
  resetPipelineConfig();
  config.telemetryPipelineErrorsEnabled = true;
  config.telemetryPipelineErrorsSlackWebhookUrl = 'https://hooks.slack.test/pipeline';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlText = String(url);
    if (urlText.includes('hooks.slack.test/pipeline')) {
      calls.push({ url: urlText, body: JSON.parse(init.body) });
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
      timezone: 'UTC',
      next_run_at: null,
      last_run_at: null,
      active: true
    });

    const run = await executeRun({
      repository,
      card,
      timeoutMs: 30000,
      maxRetries: 0
    });

    assert.equal(run.status, 'failed');
    assert.equal(calls.length, 0);
  } finally {
    global.fetch = originalFetch;
    resetPipelineConfig();
  }
});
