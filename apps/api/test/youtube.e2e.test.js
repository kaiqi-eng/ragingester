import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createMemoryRepository } from '../src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../src/repository/index.js';

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startGenieMock() {
  const state = { calls: [] };
  const server = await startServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'POST' && url.pathname === '/api/rss/fetch') {
      const payload = await readJsonBody(req);
      state.calls.push({ headers: req.headers, payload });

      return jsonResponse(res, 200, {
        source: 'discovered',
        feedUrl: payload.url,
        feed: {
          items: [
            {
              title: 'Older video',
              link: 'https://youtube.com/watch?v=old',
              content: 'old content',
              pubDate: '2026-04-20T00:00:00Z'
            },
            {
              title: 'New video',
              link: 'https://youtube.com/watch?v=new',
              content: 'new content',
              pubDate: '2026-04-23T12:00:00Z'
            }
          ]
        }
      });
    }

    jsonResponse(res, 404, { error: 'not found' });
  });

  return { ...server, state };
}

async function startBharagMock() {
  const state = {
    workspace: null,
    ownerBuilder: null,
    membersByWorkspaceId: {},
    ingests: []
  };

  const server = await startServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/v1/workspaces') {
      return jsonResponse(res, 200, {
        success: true,
        workspaces: state.workspace ? [state.workspace] : [],
        pagination: { hasMore: false, limit: Number(url.searchParams.get('limit') || 100) }
      });
    }

    if (req.method === 'POST' && pathname === '/api/v1/workspaces') {
      const payload = await readJsonBody(req);
      state.workspace = { id: 'ws-youtube', slug: payload.slug, name: payload.name };
      state.membersByWorkspaceId[state.workspace.id] = [];
      return jsonResponse(res, 200, { success: true, workspace: state.workspace });
    }

    const workspaceMembersMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members$/);
    if (workspaceMembersMatch) {
      const workspaceId = workspaceMembersMatch[1];
      if (req.method === 'GET') {
        return jsonResponse(res, 200, {
          success: true,
          members: state.membersByWorkspaceId[workspaceId] || []
        });
      }
      if (req.method === 'POST') {
        const payload = await readJsonBody(req);
        const members = state.membersByWorkspaceId[workspaceId] || [];
        members.push({ builder_id: payload.builder_id, role: payload.role });
        state.membersByWorkspaceId[workspaceId] = members;
        return jsonResponse(res, 200, { success: true });
      }
    }

    if (req.method === 'GET' && pathname === '/api/v1/builders') {
      return jsonResponse(res, 200, {
        success: true,
        builders: state.ownerBuilder ? [state.ownerBuilder] : [],
        pagination: { limit: Number(url.searchParams.get('limit') || 20), offset: Number(url.searchParams.get('offset') || 0), count: state.ownerBuilder ? 1 : 0 }
      });
    }

    if (req.method === 'POST' && pathname === '/api/v1/builders') {
      const payload = await readJsonBody(req);
      state.ownerBuilder = {
        id: 'builder-owner',
        name: payload.name,
        email: payload.email || null
      };
      return jsonResponse(res, 200, { success: true, builder: state.ownerBuilder });
    }

    if (req.method === 'POST' && pathname === '/api/v1/ingest') {
      const payload = await readJsonBody(req);
      state.ingests.push({ headers: req.headers, payload });
      return jsonResponse(res, 200, { success: true });
    }

    jsonResponse(res, 404, { error: 'not found' });
  });

  return { ...server, state };
}

function authHeaders(userId) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId
  };
}

test('youtube source type E2E across API + Genie RSS + Bharag services', async () => {
  setRepositoryForTests(createMemoryRepository());

  const genie = await startGenieMock();
  const bharag = await startBharagMock();
  const appServer = await startServer(createApp());

  try {
    const createCardRes = await fetch(`${appServer.baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders('user-e2e'),
      body: JSON.stringify({
        source_type: 'youtube',
        source_input: 'UCqzK60-oUOEq36uU9B1MMUg',
        params: {
          youtube_cursor_pub_date: '2026-04-21T00:00:00Z',
          genie_rss_base_url: genie.baseUrl,
          genie_rss_api_key: 'genie-e2e-key',
          bharag_base_url: bharag.baseUrl,
          bharag_master_api_key: 'bharag-e2e-key',
          bharag_owner_name: 'E2E Owner',
          bharag_owner_email: 'owner@example.com'
        },
        schedule_enabled: false,
        active: true
      })
    });

    assert.equal(createCardRes.status, 201);
    const card = await createCardRes.json();
    assert.ok(card.id);

    const runRes = await fetch(`${appServer.baseUrl}/cards/${card.id}/run`, {
      method: 'POST',
      headers: authHeaders('user-e2e')
    });

    assert.equal(runRes.status, 202);
    const run = await runRes.json();
    assert.equal(run.status, 'success');
    assert.equal(run.trigger_mode, 'manual');

    const cardAfterRunRes = await fetch(`${appServer.baseUrl}/cards/${card.id}`, {
      headers: authHeaders('user-e2e')
    });
    assert.equal(cardAfterRunRes.status, 200);
    const cardAfterRun = await cardAfterRunRes.json();
    assert.equal(cardAfterRun.params.youtube_workspace_id, 'ws-youtube');
    assert.equal(cardAfterRun.params.youtube_cursor_pub_date, '2026-04-23T12:00:00.000Z');

    const runsRes = await fetch(`${appServer.baseUrl}/cards/${card.id}/runs`, {
      headers: authHeaders('user-e2e')
    });
    assert.equal(runsRes.status, 200);
    const runs = await runsRes.json();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'success');

    assert.equal(genie.state.calls.length, 1);
    const genieCall = genie.state.calls[0];
    assert.equal(genieCall.headers['x-api-key'], 'genie-e2e-key');
    assert.equal(genieCall.payload.url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCqzK60-oUOEq36uU9B1MMUg');
    assert.equal(genieCall.payload.since, '2026-04-21T00:00:00.000Z');

    assert.ok(bharag.state.workspace);
    assert.equal(bharag.state.workspace.slug, 'youtube-feed');
    assert.equal((bharag.state.membersByWorkspaceId['ws-youtube'] || []).length, 1);

    assert.equal(bharag.state.ingests.length, 1);
    assert.equal(bharag.state.ingests[0].headers['x-workspace-id'], 'ws-youtube');
    assert.equal(bharag.state.ingests[0].payload.title, 'New video');
    assert.equal(bharag.state.ingests[0].payload.source_type, 'manual');
  } finally {
    await appServer.close();
    await genie.close();
    await bharag.close();
    resetRepositoryForTests();
  }
});