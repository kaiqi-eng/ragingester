import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeCollector } from '../src/collectors/youtube.js';

test('youtubeCollector normalizes channel ID and ingests only items beyond cursor', async () => {
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
          feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg',
          feed: {
            items: [
              {
                title: 'older video',
                link: 'https://www.youtube.com/watch?v=old',
                content: 'old content',
                pubDate: '2026-04-20T00:00:00Z'
              },
              {
                title: 'new video',
                link: 'https://www.youtube.com/watch?v=new',
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
          workspace: { id: 'ws-youtube' }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-youtube/members')) {
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
        json: async () => ({ success: true })
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
        json: async () => ({ success: true })
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const result = await youtubeCollector.collect({
      source_input: 'UCqzK60-oUOEq36uU9B1MMUg',
      params: {
        youtube_cursor_pub_date: '2026-04-21T00:00:00Z',
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
    assert.equal(result.card_updates.params.youtube_workspace_id, 'ws-youtube');
    assert.equal(result.card_updates.params.youtube_cursor_pub_date, '2026-04-22T09:00:00.000Z');

    const fetchCall = calls.find((call) => call.url.endsWith('/api/rss/fetch'));
    assert.ok(fetchCall);
    const fetchPayload = JSON.parse(fetchCall.options.body);
    assert.equal(fetchPayload.url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg');
    assert.equal(fetchPayload.since, '2026-04-21T00:00:00.000Z');
  } finally {
    global.fetch = originalFetch;
  }
});

test('youtubeCollector accepts direct YouTube feed URL, channel links, and handle links', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith('/api/rss/fetch')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          source: 'discovered',
          feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg',
          feed: { items: [] }
        })
      };
    }

    if (url.includes('/api/v1/workspaces?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          workspaces: [{ id: 'ws-youtube', slug: 'youtube-feed' }],
          pagination: { hasMore: false, limit: 100 }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-youtube/members')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          members: [{ role: 'owner' }]
        })
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    await youtubeCollector.collect({
      source_input: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg',
      params: {
        genie_rss_base_url: 'https://genie.example',
        genie_rss_api_key: 'genie-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    });

    const fetchCall = calls.find((call) => call.url.endsWith('/api/rss/fetch'));
    assert.ok(fetchCall);
    const fetchPayload = JSON.parse(fetchCall.options.body);
    assert.equal(fetchPayload.url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg');

    await youtubeCollector.collect({
      source_input: 'https://www.youtube.com/channel/UCqzK60-oUOEq36uU9B1MMUg',
      params: {
        genie_rss_base_url: 'https://genie.example',
        genie_rss_api_key: 'genie-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    });

    await youtubeCollector.collect({
      source_input: 'https://www.youtube.com/@GoogleDevelopers',
      params: {
        genie_rss_base_url: 'https://genie.example',
        genie_rss_api_key: 'genie-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    });

    const fetchPayloads = calls
      .filter((call) => call.url.endsWith('/api/rss/fetch'))
      .map((call) => JSON.parse(call.options.body));
    assert.equal(fetchPayloads[1].url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg');
    assert.equal(fetchPayloads[2].url, 'https://www.youtube.com/@GoogleDevelopers');
  } finally {
    global.fetch = originalFetch;
  }
});

