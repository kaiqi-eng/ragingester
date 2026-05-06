import test from 'node:test';
import assert from 'node:assert/strict';
import { smartcursorLinkCollector } from '../src/collectors/smartcursor-link.js';

test('smartcursorLinkCollector creates job, waits, ingests extracted content, and stores workspace', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

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
        json: async () => ({ workspace: { id: 'ws-smart' } })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-smart/members')) {
      if ((options.method || 'GET') === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ members: [] })
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
          builders: [],
          pagination: { limit: 20, offset: 0, count: 0 }
        })
      };
    }

    if (url.endsWith('/api/v1/builders')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ builder: { id: 'builder-owner' } })
      };
    }

    if (url.endsWith('/jobs')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'job-1', status: 'queued' })
      };
    }

    if (url.endsWith('/jobs/job-1')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          id: 'job-1',
          status: 'succeeded',
          progress: { step: 5, maxSteps: 20 },
          result: {
            pageTitle: 'Example Dashboard',
            finalUrl: 'https://example.com/app'
          }
        })
      };
    }

    if (url.endsWith('/jobs/job-1/result')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          rawText: 'First line.\nSecond line.',
          parsedPosts: [{ timestamp: '1h', content: 'post text' }]
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
    const result = await smartcursorLinkCollector.collect({
      source_input: 'https://example.com/login',
      params: {
        smartcursor_base_url: 'https://smartcursor.example',
        smartcursor_api_key: 'smart-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      },
      context: {
        triggerMode: 'manual',
        timeoutMs: 1000
      }
    });

    assert.equal(result.metrics.ingested, 1);
    assert.equal(result.normalized.workspace_id, 'ws-smart');
    assert.equal(result.card_updates.params.smartcursor_workspace_id, 'ws-smart');

    const createJobCall = calls.find((call) => call.url.endsWith('/jobs'));
    assert.ok(createJobCall, 'smartcursor job creation should be called');
    const createJobPayload = JSON.parse(createJobCall.options.body);
    assert.equal(createJobPayload.url, 'https://example.com/login');
    assert.equal(createJobPayload.maxSteps, 20);

    const ingestCall = calls.find((call) => call.url.endsWith('/api/v1/ingest'));
    assert.ok(ingestCall, 'ingest endpoint should be called');
    const ingestPayload = JSON.parse(ingestCall.options.body);
    assert.equal(ingestPayload.title, 'Example Dashboard');
    assert.match(ingestPayload.content, /First line/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('smartcursorLinkCollector passes login fields from params.auth.login_fields', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes('/api/v1/workspaces?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          workspaces: [{ id: 'ws-smart', slug: 'smartcursor-link' }],
          pagination: { hasMore: false, limit: 100 }
        })
      };
    }

    if (url.endsWith('/api/v1/workspaces/ws-smart/members')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ members: [{ role: 'owner' }] })
      };
    }

    if (url.endsWith('/jobs')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'job-auth', status: 'queued' })
      };
    }

    if (url.endsWith('/jobs/job-auth')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          id: 'job-auth',
          status: 'succeeded',
          progress: { step: 1, maxSteps: 2 },
          result: { pageTitle: 'Private Page', finalUrl: 'https://example.com/private' }
        })
      };
    }

    if (url.endsWith('/jobs/job-auth/result')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ rawText: 'Private content' })
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
    await smartcursorLinkCollector.collect({
      source_input: 'https://example.com/private',
      params: {
        smartcursor_base_url: 'https://smartcursor.example',
        smartcursor_api_key: 'smart-key',
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key',
        auth: {
          login_fields: [
            { name: 'username', selector: '#username', value: 'demo' },
            { name: 'password', selector: '#password', value: 'secret', secret: true }
          ]
        }
      }
    });

    const createJobCall = calls.find((call) => call.url.endsWith('/jobs'));
    const payload = JSON.parse(createJobCall.options.body);
    assert.equal(payload.loginFields.length, 2);
    assert.equal(payload.loginFields[1].secret, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('smartcursorLinkCollector throws when smartcursor config is missing', async () => {
  await assert.rejects(
    () => smartcursorLinkCollector.collect({
      source_input: 'https://example.com',
      params: {
        bharag_base_url: 'https://bharag.example',
        bharag_master_api_key: 'bharag-key'
      }
    }),
    /SMARTCURSOR_BASE_URL is required/
  );
});

test('smartcursorLinkCollector fails run when smartcursor job fails', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url.includes('/api/v1/workspaces?')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          workspaces: [{ id: 'ws-smart', slug: 'smartcursor-link' }],
          pagination: { hasMore: false, limit: 100 }
        })
      };
    }
    if (url.endsWith('/api/v1/workspaces/ws-smart/members')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ members: [{ role: 'owner' }] })
      };
    }
    if (url.endsWith('/jobs')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'job-fail', status: 'queued' })
      };
    }
    if (url.endsWith('/jobs/job-fail')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'job-fail', status: 'failed', error: 'Login checkpoint blocked' })
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    await assert.rejects(
      () => smartcursorLinkCollector.collect({
        source_input: 'https://example.com/login',
        params: {
          smartcursor_base_url: 'https://smartcursor.example',
          smartcursor_api_key: 'smart-key',
          bharag_base_url: 'https://bharag.example',
          bharag_master_api_key: 'bharag-key'
        },
        context: {
          timeoutMs: 100
        }
      }),
      /smartcursor job failed/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
