import test from 'node:test';
import assert from 'node:assert/strict';
import { slackEngineFetchCollector } from '../src/collectors/slack-engine-fetch.js';

function expectedPreviousDay(timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

test('slackEngineFetchCollector fetches previous-day content, ingests raw body, and stores workspace/date', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const expectedDate = expectedPreviousDay('America/Chicago');

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes('/webhook/slack-engine/fetch')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          channel_name: 'bha-coordination',
          channel_id: 'C0ASMPYQLG3',
          doc_url: 'https://docs.google.com/document/d/abc/edit',
          date: expectedDate,
          content: `BHA Slack Engine | #bha-coordination | ${expectedDate}\n\nDaily notes...`
        })
      };
    }

    if (url.includes('/api/v1/workspaces?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          workspaces: [{ id: 'ws-slack', slug: 'slack-engine-fetch' }],
          pagination: { hasMore: false, limit: 100 }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-slack/members')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ members: [{ role: 'owner' }] })
      };
    }

    if (url.endsWith('/api/v1/ingest')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true })
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const result = await slackEngineFetchCollector.collect({
      source_input: 'bha-coordination',
      params: {
        slack_engine_base_url: 'https://n8n.arupiautomates.com',
        slack_engine_api_key: 'slack-engine-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      },
      context: {
        card: { timezone: 'America/Chicago' },
        triggerMode: 'scheduled'
      }
    });

    const fetchCall = calls.find((call) => String(call.url).includes('/webhook/slack-engine/fetch'));
    assert.ok(fetchCall);
    assert.match(String(fetchCall.url), /channel=bha-coordination/);
    assert.match(String(fetchCall.url), new RegExp(`date=${expectedDate}`));
    assert.equal(fetchCall.options.headers['x-api-key'], 'slack-engine-key');

    const ingestCall = calls.find((call) => String(call.url).endsWith('/api/v1/ingest'));
    assert.ok(ingestCall);
    const ingestPayload = JSON.parse(ingestCall.options.body);
    assert.equal(ingestPayload.content, `BHA Slack Engine | #bha-coordination | ${expectedDate}\n\nDaily notes...`);
    assert.equal(ingestPayload.source_url, 'https://docs.google.com/document/d/abc/edit');
    assert.equal(ingestPayload.metadata.ingestion_type, 'slack_engine_fetch');
    assert.equal(ingestPayload.metadata.channel_name, 'bha-coordination');
    assert.equal(ingestPayload.metadata.date, expectedDate);

    assert.equal(result.metrics.ingested, 1);
    assert.equal(result.card_updates.params.slack_engine_workspace_id, 'ws-slack');
    assert.equal(result.card_updates.params.slack_engine_last_date, expectedDate);
  } finally {
    global.fetch = originalFetch;
  }
});

test('slackEngineFetchCollector throws clear error when Slack Engine auth fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/webhook/slack-engine/fetch')) {
      return {
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: false, error: 'Authorization data is wrong!' })
      };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    await assert.rejects(
      () => slackEngineFetchCollector.collect({
        source_input: 'bha-coordination',
        params: {
          slack_engine_base_url: 'https://n8n.arupiautomates.com',
          slack_engine_api_key: 'bad-key',
          bharag_base_url: 'https://bharag.example',
          bharag_master_api_key: 'bharag-key'
        },
        context: {
          card: { timezone: 'America/Chicago' }
        }
      }),
      /slack_engine_fetch failed.*channel=bha-coordination.*date=.*403/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('slackEngineFetchCollector throws clear error when document is missing', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/webhook/slack-engine/fetch')) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: false, error: 'No document found for that channel and date.' })
      };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    await assert.rejects(
      () => slackEngineFetchCollector.collect({
        source_input: 'bha-coordination',
        params: {
          slack_engine_base_url: 'https://n8n.arupiautomates.com',
          slack_engine_api_key: 'key',
          bharag_base_url: 'https://bharag.example',
          bharag_master_api_key: 'bharag-key'
        },
        context: {
          card: { timezone: 'America/Chicago' }
        }
      }),
      /slack_engine_fetch failed.*channel=bha-coordination.*date=.*404/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('slackEngineFetchCollector throws when Slack Engine API key is missing', async () => {
  await assert.rejects(
    () => slackEngineFetchCollector.collect({
      source_input: 'bha-coordination',
      params: {
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    }),
    /SLACK_ENGINE_API_KEY is required/
  );
});
