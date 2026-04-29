import test from 'node:test';
import assert from 'node:assert/strict';
import { rssFeedCollector } from '../src/collectors/rss-feed.js';

test('rssFeedCollector ingests only items beyond cursor and writes post timestamp template', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith('/api/rss/fetch')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          source: 'discovered',
          feedUrl: 'https://example.com/feed.xml',
          feed: {
            items: [
              {
                title: 'old post',
                link: 'https://example.com/old',
                content: 'old content',
                pubDate: '2026-04-20T00:00:00Z'
              },
              {
                title: 'new post',
                link: 'https://example.com/new',
                content: 'new content',
                pubDate: '2026-04-22T09:00:00Z'
              }
            ]
          }
        })
      };
    }

    if (url.includes('/api/v1/workspaces?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          workspaces: [],
          pagination: { hasMore: false, limit: 100 }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          workspace: { id: 'ws-rss' }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-rss/members')) {
      if ((options.method || 'GET') === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            members: []
          })
        };
      }

      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true
        })
      };
    }

    if (url.includes('/api/v1/builders?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          builders: [],
          pagination: { limit: 20, offset: 0, count: 0 }
        })
      };
    }

    if (url.endsWith('/api/v1/builders')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          builder: { id: 'builder-owner' }
        })
      };
    }

    if (url.endsWith('/api/v1/ingest')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true
        })
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const result = await rssFeedCollector.collect({
      source_input: 'https://example.com/feed.xml',
      params: {
        rss_cursor_pub_date: '2026-04-21T00:00:00Z',
        genie_rss_base_url: 'https://genie.example',
        genie_rss_api_key: 'genie-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      },
      context: {
        triggerMode: 'scheduled'
      }
    });

    assert.equal(result.metrics.fetched, 2);
    assert.equal(result.metrics.selected, 1);
    assert.equal(result.metrics.ingested, 1);
    assert.equal(result.card_updates.params.rss_workspace_id, 'ws-rss');
    assert.equal(result.card_updates.params.rss_cursor_pub_date, '2026-04-22T09:00:00.000Z');
    assert.equal(result.normalized.owner_builder_id, 'builder-owner');

    const ingestCall = calls.find((call) => call.url.endsWith('/api/v1/ingest'));
    assert.ok(ingestCall, 'ingest endpoint should be called');

    const ingestBody = JSON.parse(ingestCall.options.body);
    assert.match(ingestBody.content, /TAGs: \[RSS\]/);
    assert.match(ingestBody.content, /Previous run: 2026-04-21T00:00:00.000Z/);
    assert.match(ingestBody.content, /Post timestamp: 2026-04-22T09:00:00.000Z/);
    assert.match(ingestBody.content, /Title: new post/);
    assert.match(ingestBody.content, /Content: new content/);
    assert.match(ingestBody.content, /Link: https:\/\/example.com\/new/);

    const addOwnerCall = calls.find((call) => call.url.endsWith('/api/v1/workspaces/ws-rss/members') && (call.options.method || 'GET') === 'POST');
    assert.ok(addOwnerCall, 'workspace owner should be added');
    const addOwnerBody = JSON.parse(addOwnerCall.options.body);
    assert.equal(addOwnerBody.builder_id, 'builder-owner');
    assert.equal(addOwnerBody.role, 'owner');
  } finally {
    global.fetch = originalFetch;
  }
});
