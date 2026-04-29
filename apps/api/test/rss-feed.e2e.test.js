import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rssFeedCollector } from '../src/collectors/rss-feed.js';

const runFlag = (process.env.RUN_RSS_E2E || '').trim().toLowerCase();
const shouldRun = ['1', 'true', 'yes', 'on'].includes(runFlag);
const required = [
  'GENIE_RSS_API_KEY',
  'BHARAG_MASTER_API_KEY'
];
const missing = required.filter((key) => !process.env[key]);
const skipReason = !shouldRun
  ? 'set RUN_RSS_E2E to 1/true/yes/on to run live rss e2e'
  : (missing.length > 0 ? `missing required env vars: ${missing.join(', ')}` : null);

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(`request failed (${response.status}) for ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function tryDelete(url, headers) {
  try {
    await fetch(url, { method: 'DELETE', headers });
  } catch {
    // best effort cleanup
  }
}

test('e2e: genie-rss -> ragingester -> bharag with temporary workspace owner and cleanup', { skip: skipReason }, async () => {
  const genieBaseUrl = trimTrailingSlash(process.env.GENIE_RSS_BASE_URL || 'https://genie-rss-5i00.onrender.com');
  const bharagBaseUrl = trimTrailingSlash(process.env.BHARAG_BASE_URL || 'https://bharag.duckdns.org');
  const genieApiKey = process.env.GENIE_RSS_API_KEY;
  const bharagApiKey = process.env.BHARAG_MASTER_API_KEY;

  const suffix = randomUUID().slice(0, 8);
  const workspaceSlug = `rss-e2e-${suffix}`;
  const workspaceName = `RSS E2E ${suffix}`;
  const ownerName = `Ragingester E2E Owner ${suffix}`;
  const ownerEmail = `ragingester-e2e-${suffix}@example.com`;

  const adminHeaders = {
    'content-type': 'application/json',
    'x-api-key': bharagApiKey
  };

  let builderId = null;
  let workspaceId = null;

  try {
    const builderResponse = await fetchJson(`${bharagBaseUrl}/api/v1/builders`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: ownerName,
        email: ownerEmail,
        role: 'admin'
      })
    });
    builderId = builderResponse?.builder?.id || null;
    assert.ok(builderId, 'expected created builder id');

    const workspaceResponse = await fetchJson(`${bharagBaseUrl}/api/v1/workspaces`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: workspaceName,
        slug: workspaceSlug
      })
    });
    workspaceId = workspaceResponse?.workspace?.id || null;
    assert.ok(workspaceId, 'expected created workspace id');

    await fetchJson(`${bharagBaseUrl}/api/v1/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        builder_id: builderId,
        role: 'owner'
      })
    });

    const result = await rssFeedCollector.collect({
      source_input: 'https://techcrunch.com/feed/',
      params: {
        genie_rss_base_url: genieBaseUrl,
        genie_rss_api_key: genieApiKey,
        bharag_base_url: bharagBaseUrl,
        bharag_master_api_key: bharagApiKey,
        bharag_owner_builder_id: builderId,
        bharag_owner_name: ownerName,
        bharag_owner_email: ownerEmail,
        rss_workspace_id: workspaceId
      },
      context: { triggerMode: 'manual' }
    });

    assert.equal(result.normalized.workspace_id, workspaceId);
    assert.equal(result.normalized.trigger_mode, 'manual');
    assert.ok(result.metrics.fetched > 0, 'expected fetched rss items');
    assert.ok(result.metrics.ingested > 0, 'expected at least one ingested item');
    assert.ok(Array.isArray(result.logs), 'expected collector logs');
  } finally {
    if (workspaceId) {
      await tryDelete(`${bharagBaseUrl}/api/v1/workspaces/${workspaceId}`, adminHeaders);
    }
    if (builderId) {
      await tryDelete(`${bharagBaseUrl}/api/v1/builders/${builderId}`, adminHeaders);
    }
  }
});
