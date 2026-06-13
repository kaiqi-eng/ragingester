import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedinCollector } from '../src/collectors/linkedin.js';

function jsonResponse(body, ok = true) {
  return {
    ok,
    headers: { get: () => 'application/json' },
    json: async () => body
  };
}

test('linkedinCollector fetches profile posts and ingests only items beyond cursor', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith('/api/linkedin/profile-posts')) {
      return jsonResponse({
        success: true,
        data: [
          {
            title: 'Older LinkedIn Post',
            content: 'old content',
            source_id: 'old-post',
            source_url: 'https://www.linkedin.com/posts/old',
            metadata: {
              author: 'Satya Nadella',
              pubDate: '2026-04-20T00:00:00Z',
              reactions: 3
            }
          },
          {
            title: 'New LinkedIn Post',
            content: 'new content',
            source_id: 'new-post',
            source_url: 'https://www.linkedin.com/posts/new',
            metadata: {
              author: 'Satya Nadella',
              pubDate: '2026-04-22T09:00:00Z',
              reactions: 10
            }
          }
        ]
      });
    }

    if (url.includes('/api/v1/workspaces?')) {
      return jsonResponse({
        success: true,
        workspaces: [],
        pagination: { hasMore: false, limit: 100 }
      });
    }

    if (url.endsWith('/api/v1/workspaces')) {
      return jsonResponse({
        success: true,
        workspace: { id: 'ws-linkedin' }
      });
    }

    if (url.endsWith('/api/v1/workspaces/ws-linkedin/members')) {
      if ((options.method || 'GET') === 'GET') {
        return jsonResponse({
          success: true,
          members: []
        });
      }
      return jsonResponse({ success: true });
    }

    if (url.includes('/api/v1/builders?')) {
      return jsonResponse({
        success: true,
        builders: [],
        pagination: { limit: 20, offset: 0, count: 0 }
      });
    }

    if (url.endsWith('/api/v1/builders')) {
      return jsonResponse({
        success: true,
        builder: { id: 'builder-owner' }
      });
    }

    if (url.endsWith('/api/v1/ingest')) {
      return jsonResponse({ success: true });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const result = await linkedinCollector.collect({
      source_input: 'https://www.linkedin.com/in/satyanadella/',
      params: {
        linkedin_cursor_pub_date: '2026-04-21T00:00:00Z',
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
    assert.equal(result.metrics.failed, 0);
    assert.equal(result.card_updates.params.linkedin_workspace_id, 'ws-linkedin');
    assert.equal(result.card_updates.params.linkedin_cursor_pub_date, '2026-04-22T09:00:00.000Z');

    const fetchCall = calls.find((call) => call.url.endsWith('/api/linkedin/profile-posts'));
    assert.ok(fetchCall);
    assert.equal(fetchCall.options.headers['x-api-key'], 'genie-key');
    const fetchPayload = JSON.parse(fetchCall.options.body);
    assert.equal(fetchPayload.profileUrl, 'https://www.linkedin.com/in/satyanadella/');
    assert.equal(fetchPayload.maxPosts, 10);

    const ingestCall = calls.find((call) => call.url.endsWith('/api/v1/ingest'));
    assert.ok(ingestCall);
    assert.equal(ingestCall.options.headers['x-workspace-id'], 'ws-linkedin');
    const ingestPayload = JSON.parse(ingestCall.options.body);
    assert.equal(ingestPayload.source_type, 'manual');
    assert.equal(ingestPayload.project_tags[0], 'linkedin');
    assert.equal(ingestPayload.metadata.ingestion_type, 'linkedin');
    assert.equal(ingestPayload.metadata.item_guid, 'new-post');
  } finally {
    global.fetch = originalFetch;
  }
});

test('linkedinCollector builds topic payload and reports partial ingest failures', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  let ingestCount = 0;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith('/api/linkedin/topic-posts')) {
      return jsonResponse({
        success: true,
        data: [
          {
            title: 'First Topic Post',
            content: 'first content',
            source_id: 'topic-first',
            source_url: 'https://www.linkedin.com/posts/topic-first',
            metadata: {
              author: 'Author One',
              pubDate: '2026-04-22T09:00:00Z',
              reactions: 2
            }
          },
          {
            title: 'Second Topic Post',
            content: 'second content',
            source_id: 'topic-second',
            source_url: 'https://www.linkedin.com/posts/topic-second',
            metadata: {
              author: 'Author Two',
              pubDate: '2026-04-23T10:00:00Z',
              reactions: 5
            }
          }
        ]
      });
    }

    if (url.includes('/api/v1/workspaces?')) {
      return jsonResponse({
        success: true,
        workspaces: [{ id: 'ws-linkedin', slug: 'linkedin-feed' }],
        pagination: { hasMore: false, limit: 100 }
      });
    }

    if (url.endsWith('/api/v1/workspaces/ws-linkedin/members')) {
      return jsonResponse({
        success: true,
        members: [{ role: 'owner' }]
      });
    }

    if (url.endsWith('/api/v1/ingest')) {
      ingestCount += 1;
      if (ingestCount === 2) {
        return jsonResponse({ error: 'ingest failed' }, false);
      }
      return jsonResponse({ success: true });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const result = await linkedinCollector.collect({
      source_input: 'b2b sales, revenue operations',
      params: {
        linkedin_mode: 'topic',
        authorsCompanies: ['Microsoft'],
        contentType: 'posts',
        maxPosts: 20,
        scrapeComments: true,
        genie_rss_base_url: 'https://genie.example',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    });

    assert.equal(result.metrics.fetched, 2);
    assert.equal(result.metrics.selected, 2);
    assert.equal(result.metrics.ingested, 1);
    assert.equal(result.metrics.failed, 1);
    assert.equal(result.card_updates.params.linkedin_cursor_pub_date, '2026-04-22T09:00:00.000Z');
    assert.equal(result.logs.some((entry) => entry.level === 'warn'), true);

    const fetchCall = calls.find((call) => call.url.endsWith('/api/linkedin/topic-posts'));
    assert.ok(fetchCall);
    assert.equal(fetchCall.options.headers['x-api-key'], undefined);
    const fetchPayload = JSON.parse(fetchCall.options.body);
    assert.deepEqual(fetchPayload.searchQueries, ['b2b sales', 'revenue operations']);
    assert.deepEqual(fetchPayload.authorsCompanies, ['Microsoft']);
    assert.equal(fetchPayload.contentType, 'posts');
    assert.equal(fetchPayload.maxPosts, 20);
    assert.equal(fetchPayload.scrapeComments, true);
  } finally {
    global.fetch = originalFetch;
  }
});
