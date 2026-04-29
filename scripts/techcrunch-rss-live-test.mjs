import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/src/app.js';
import { createMemoryRepository } from '../apps/api/src/repository/memory-repository.js';
import { resetRepositoryForTests, setRepositoryForTests } from '../apps/api/src/repository/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const FEED_URL = 'https://techcrunch.com/feed/';
const DEV_USER_ID = process.env.DEV_USER_ID || 'dev-user-1';
const BHARAG_BASE_URL = process.env.BHARAG_BASE_URL || '';
const BHARAG_MASTER_API_KEY = process.env.BHARAG_MASTER_API_KEY || '';

function authHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': DEV_USER_ID
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function run() {
  setRepositoryForTests(createMemoryRepository());

  const outboundPayloads = [];
  const cleanup = {
    attempted: 0,
    deleted: 0,
    failed: 0,
    deleted_ids: [],
    failures: []
  };
  const ingestedDocs = new Map();
  let createCardResponse;
  let createCardBody = null;
  let runResponse;
  let runBody = null;
  let listRunsResponse;
  let listRunsBody = null;
  let testError = null;

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const startedAt = new Date().toISOString();
    const method = options.method || 'GET';
    const requestBody = typeof options.body === 'string' ? options.body : null;
    const requestHeaders = options.headers || {};

    const response = await originalFetch(url, options);
    const cloned = response.clone();
    const rawBody = await cloned.text();

    outboundPayloads.push({
      started_at: startedAt,
      url: String(url),
      method,
      request_headers: requestHeaders,
      request_body_raw: requestBody,
      request_body_json: requestBody ? safeJsonParse(requestBody) : null,
      response_status: response.status,
      response_headers: Object.fromEntries(cloned.headers.entries()),
      response_body_raw: rawBody,
      response_body_json: safeJsonParse(rawBody)
    });

    const responseJson = safeJsonParse(rawBody);
    if (
      String(url).includes('/api/v1/ingest')
      && response.status === 201
      && responseJson?.document?.id
    ) {
      const workspaceId = requestHeaders['x-workspace-id'] || requestHeaders['X-Workspace-ID'] || null;
      ingestedDocs.set(responseJson.document.id, workspaceId);
    }

    return response;
  };

  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    createCardResponse = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        source_type: 'rss_feed',
        source_input: FEED_URL,
        params: {},
        schedule_enabled: false,
        cron_expression: null,
        timezone: 'America/Chicago',
        active: true
      })
    });
    createCardBody = await createCardResponse.json();

    runResponse = await fetch(`${baseUrl}/cards/${createCardBody.id}/run`, {
      method: 'POST',
      headers: authHeaders()
    });
    runBody = await runResponse.json();

    listRunsResponse = await fetch(`${baseUrl}/cards/${createCardBody.id}/runs`, {
      headers: authHeaders()
    });
    listRunsBody = await listRunsResponse.json();
  } catch (error) {
    testError = error;
  } finally {
    if (BHARAG_BASE_URL && BHARAG_MASTER_API_KEY && ingestedDocs.size > 0) {
      for (const [documentId, workspaceId] of ingestedDocs.entries()) {
        cleanup.attempted += 1;
        try {
          if (!workspaceId) throw new Error(`missing workspace id for document ${documentId}`);

          const response = await fetch(`${BHARAG_BASE_URL}/api/v1/documents/${documentId}`, {
            method: 'DELETE',
            headers: {
              'x-api-key': BHARAG_MASTER_API_KEY,
              'x-workspace-id': workspaceId
            }
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`delete failed (${response.status}): ${body}`);
          }

          cleanup.deleted += 1;
          cleanup.deleted_ids.push(documentId);
        } catch (error) {
          cleanup.failed += 1;
          cleanup.failures.push({
            document_id: documentId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    global.fetch = originalFetch;
    resetRepositoryForTests();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const artifact = {
    scenario: 'techcrunch_rss_live_ingestion',
    feed_url: FEED_URL,
    timestamp: new Date().toISOString(),
    local_api: {
      create_card: createCardResponse ? { status: createCardResponse.status, body: createCardBody } : null,
      run_card: runResponse ? { status: runResponse.status, body: runBody } : null,
      list_runs: listRunsResponse ? { status: listRunsResponse.status, body: listRunsBody } : null
    },
    cleanup,
    outbound_payloads: outboundPayloads
  };

  const artifactDir = path.join(projectRoot, 'test-artifacts');
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(
    artifactDir,
    `techcrunch-rss-live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  if (testError) {
    throw Object.assign(new Error(testError.message), { artifactPath });
  }

  if (cleanup.failed > 0) {
    throw Object.assign(new Error(`cleanup failed for ${cleanup.failed} documents`), { artifactPath });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, artifact_path: artifactPath, cleanup }, null, 2));
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
        artifact_path: error.artifactPath || null,
        stack: error.stack
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
