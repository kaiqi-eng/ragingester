import { config } from '../config.js';

const SMARTCURSOR_JOB_POLL_MS = 3000;
const SMARTCURSOR_JOB_TIMEOUT_MS = 4 * 60 * 1000;
const MIN_BOOK_CONTENT_LENGTH = 10;

class RequestError extends Error {
  constructor(message, { status }) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function pickParam(params, key, fallback) {
  const value = params?.[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function resolveIntegrationConfig(params = {}) {
  return {
    smartcursorBaseUrl: trimTrailingSlash(pickParam(params, 'smartcursor_base_url', config.smartcursorBaseUrl)),
    smartcursorApiKey: pickParam(params, 'smartcursor_api_key', config.smartcursorApiKey),
    bharagBaseUrl: trimTrailingSlash(pickParam(params, 'bharag_base_url', config.bharagBaseUrl)),
    workspaceId: pickParam(params, 'bharag_smartcursor_workspace_id', config.bharagSmartcursorWorkspaceId),
    workspaceApiKey: config.bharagSmartcursorWorkspaceApiKey,
    ledgerSchema: pickParam(params, 'bharag_smartcursor_ledger_schema', config.bharagSmartcursorLedgerSchema)
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new RequestError(`request failed (${response.status}) for ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`, {
      status: response.status
    });
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveLoginFields(params = {}) {
  const auth = params.auth;
  if (!auth || typeof auth !== 'object') return [];
  if (!Array.isArray(auth.login_fields)) return [];
  return auth.login_fields
    .filter((field) => field && typeof field === 'object')
    .map((field) => ({
      name: String(field.name || ''),
      selector: String(field.selector || ''),
      value: String(field.value || ''),
      ...(field.secret === true ? { secret: true } : {})
    }))
    .filter((field) => field.name && field.selector);
}

function buildJobPayload({ sourceInput, params = {} }) {
  const goal = pickParam(params, 'goal', 'Extract key readable content from this page for ingestion.');
  const payload = {
    url: sourceInput,
    goal,
    maxSteps: Number.isFinite(Number(params.max_steps)) ? Number(params.max_steps) : 20
  };

  const loginFields = resolveLoginFields(params);
  if (loginFields.length > 0) {
    payload.loginFields = loginFields;
  }

  if (params.extraction_schema && typeof params.extraction_schema === 'object') {
    payload.extractionSchema = params.extraction_schema;
  }

  return payload;
}

async function createSmartcursorJob({ cfg, sourceInput, params = {} }) {
  const payload = buildJobPayload({ sourceInput, params });
  const response = await fetchJson(`${cfg.smartcursorBaseUrl}/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.smartcursorApiKey
    },
    body: JSON.stringify(payload)
  });

  const jobId = response.id || response.jobId;
  if (!jobId) {
    throw new Error('smartcursor job creation failed: missing id');
  }

  return { id: jobId, payload };
}

async function waitForSmartcursorJob({ cfg, jobId, timeoutMs = SMARTCURSOR_JOB_TIMEOUT_MS, pollMs = SMARTCURSOR_JOB_POLL_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = await fetchJson(`${cfg.smartcursorBaseUrl}/jobs/${jobId}`, {
      headers: {
        'x-api-key': cfg.smartcursorApiKey
      }
    });

    if (status.status === 'succeeded') return status;
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`smartcursor job ${status.status}: ${status.error || 'no details'}`);
    }

    await sleep(pollMs);
  }

  throw new Error('smartcursor job timeout');
}

async function fetchSmartcursorResult({ cfg, jobId }) {
  return fetchJson(`${cfg.smartcursorBaseUrl}/jobs/${jobId}/result`, {
    headers: {
      'x-api-key': cfg.smartcursorApiKey
    }
  });
}

function normalizeExtractedText(result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.rawText === 'string' && result.rawText.trim()) return result.rawText;
  if (Array.isArray(result.parsedPosts) && result.parsedPosts.length > 0) {
    return result.parsedPosts.map((post) => `${post.timestamp || 'unknown'}: ${post.content || ''}`).join('\n\n');
  }
  return JSON.stringify(result);
}

async function listBharagWorkspaces({ cfg, limit = 100, offset = 0 }) {
  if (!cfg.bharagMasterApiKey) {
    throw new Error('BHARAG_MASTER_API_KEY is required for smartcursor_link ingestion');
  }

  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/workspaces?limit=${limit}&offset=${offset}`, {
    headers: {
      'x-api-key': cfg.bharagMasterApiKey
    }
  });
}

async function createBharagWorkspace({ cfg }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/workspaces`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.bharagMasterApiKey
    },
    body: JSON.stringify({
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG
    })
  });
}

async function listBharagWorkspaceMembers({ cfg, workspaceId }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/workspaces/${workspaceId}/members`, {
    headers: {
      'x-api-key': cfg.bharagMasterApiKey
    }
  });
}

async function listBharagBuilders({ cfg, limit = 100, offset = 0 }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/builders?limit=${limit}&offset=${offset}`, {
    headers: {
      'x-api-key': cfg.bharagMasterApiKey
    }
  });
}

async function createBharagBuilder({ cfg }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/builders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.bharagMasterApiKey
    },
    body: JSON.stringify({
      name: cfg.bharagOwnerName || 'Ragingester SmartCursor Owner',
      ...(cfg.bharagOwnerEmail ? { email: cfg.bharagOwnerEmail } : {}),
      role: 'admin'
    })
  });
}

async function addWorkspaceOwner({ cfg, workspaceId, builderId }) {
  try {
    await fetchJson(`${cfg.bharagBaseUrl}/api/v1/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.bharagMasterApiKey
      },
      body: JSON.stringify({
        builder_id: builderId,
        role: 'owner'
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('409')) throw error;

    await fetchJson(`${cfg.bharagBaseUrl}/api/v1/workspaces/${workspaceId}/members/${builderId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.bharagMasterApiKey
      },
      body: JSON.stringify({ role: 'owner' })
    });
  }
}

async function resolveOwnerBuilderId(cfg) {
  if (cfg.bharagOwnerBuilderId) return cfg.bharagOwnerBuilderId;

  let offset = 0;
  while (offset < 1000) {
    const listResponse = await listBharagBuilders({ cfg, offset });
    const builders = Array.isArray(listResponse.builders) ? listResponse.builders : [];

    const matched = builders.find((builder) => (
      (cfg.bharagOwnerEmail && builder.email && builder.email.toLowerCase() === cfg.bharagOwnerEmail.toLowerCase())
      || (cfg.bharagOwnerName && builder.name === cfg.bharagOwnerName)
    ));
    if (matched?.id) return matched.id;

    if (!listResponse.pagination || builders.length === 0 || builders.length < (listResponse.pagination.limit || 20)) break;
    offset += listResponse.pagination.limit || builders.length;
  }

  const created = await createBharagBuilder({ cfg });
  if (!created.builder?.id) {
    throw new Error('failed to create Bharag owner builder');
  }
  return created.builder.id;
}

async function ensureWorkspaceHasOwner({ cfg, workspaceId }) {
  const membersResponse = await listBharagWorkspaceMembers({ cfg, workspaceId });
  const members = Array.isArray(membersResponse.members) ? membersResponse.members : [];
  const hasOwner = members.some((member) => member.role === 'owner');
  if (hasOwner) return null;

  const ownerBuilderId = await resolveOwnerBuilderId(cfg);
  await addWorkspaceOwner({ cfg, workspaceId, builderId: ownerBuilderId });
  return ownerBuilderId;
}

async function resolveWorkspaceId(cfg) {
  if (cfg.workspaceId) {
    const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: cfg.workspaceId });
    return { workspaceId: cfg.workspaceId, ownerBuilderId };
  }

  let offset = 0;
  while (offset < 1000) {
    const listResponse = await listBharagWorkspaces({ cfg, offset });
    const workspaces = Array.isArray(listResponse.workspaces) ? listResponse.workspaces : [];
    const matched = workspaces.find((workspace) => workspace.slug === WORKSPACE_SLUG);
    if (matched?.id) {
      const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: matched.id });
      return { workspaceId: matched.id, ownerBuilderId };
    }

    if (!listResponse.pagination?.hasMore) break;
    offset += listResponse.pagination.limit || workspaces.length || 100;
  }

  const created = await createBharagWorkspace({ cfg });
  if (!created.workspace?.id) {
    throw new Error('failed to create Bharag workspace for smartcursor_link ingestion');
  }
  const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: created.workspace.id });
  return { workspaceId: created.workspace.id, ownerBuilderId };
}

function assertBharagSmartcursorConfig(cfg) {
  if (!cfg.workspaceId) throw new Error('BHARAG_SMARTCURSOR_WORKSPACE_ID is required for smartcursor_link ingestion');
  if (!cfg.workspaceApiKey) throw new Error('BHARAG_SMARTCURSOR_WORKSPACE_API_KEY is required for smartcursor_link ingestion');
  if (!cfg.ledgerSchema) throw new Error('BHARAG_SMARTCURSOR_LEDGER_SCHEMA is required for smartcursor_link ingestion');
}

function ingestHeaders(cfg, workspaceId, payloadType, payloadSchema) {
  return {
    'content-type': 'application/json',
    'x-api-key': cfg.workspaceApiKey,
    'x-workspace-id': workspaceId,
    'payload-type': payloadType,
    ...(payloadSchema ? { 'payload-schema': payloadSchema } : {})
  };
}

async function ingestBookDocument({ cfg, workspaceId, title, content }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: ingestHeaders(cfg, workspaceId, 'rag'),
    body: JSON.stringify({
      title,
      content: content.trim(),
      source_type: 'manual'
    })
  });
}

async function ingestLedgerEvent({ cfg, workspaceId, sourceInput, jobId, finalUrl, authMode, title, occurredAt }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: ingestHeaders(cfg, workspaceId, 'ledger', cfg.ledgerSchema),
    body: JSON.stringify({
      occurred_at: occurredAt,
      entity_type: 'document',
      entity_id: jobId,
      source: sourceInput,
      summary: `SmartCursor capture: ${title}`,
      payload: {
        source_type: 'manual',
        content_type: 'doc',
        source_url: finalUrl,
        project_tags: ['smartcursor', 'browser'],
        ingestion_type: 'smartcursor_link',
        job_id: jobId,
        final_url: finalUrl,
        auth_mode: authMode
      }
    })
  });
}

export const smartcursorLinkCollector = {
  id: 'smartcursor_link',
  async collect({ source_input, params = {}, context = {} }) {
    const cfg = resolveIntegrationConfig(params);
    if (!cfg.smartcursorBaseUrl) {
      throw new Error('SMARTCURSOR_BASE_URL is required for smartcursor_link ingestion');
    }
    if (!cfg.smartcursorApiKey) {
      throw new Error('SMARTCURSOR_API_KEY is required for smartcursor_link ingestion');
    }
    assertBharagSmartcursorConfig(cfg);
    const created = await createSmartcursorJob({ cfg, sourceInput: source_input, params });
    const status = await waitForSmartcursorJob({
      cfg,
      jobId: created.id,
      timeoutMs: context.timeoutMs || SMARTCURSOR_JOB_TIMEOUT_MS
    });
    const result = await fetchSmartcursorResult({ cfg, jobId: created.id });

    const extractedText = normalizeExtractedText(result);
    const pageTitle = result.pageTitle || status.result?.pageTitle || `SmartCursor capture: ${source_input}`;
    const finalUrl = result.finalUrl || status.result?.finalUrl || source_input;
    const authMode = resolveLoginFields(params).length > 0 ? 'login_fields' : 'none';
    if (extractedText.trim().length < MIN_BOOK_CONTENT_LENGTH) {
      throw new Error(`SmartCursor extracted content must contain at least ${MIN_BOOK_CONTENT_LENGTH} characters`);
    }

    await ingestBookDocument({
      cfg,
      workspaceId: cfg.workspaceId,
      title: pageTitle,
      content: extractedText
    });
    await ingestLedgerEvent({
      cfg,
      workspaceId: cfg.workspaceId,
      sourceInput: source_input,
      jobId: created.id,
      finalUrl,
      authMode,
      title: pageTitle,
      occurredAt: new Date().toISOString()
    });

    return {
      raw: {
        job: status,
        result
      },
      normalized: {
        source_type: 'smartcursor_link',
        trigger_mode: context.triggerMode || null,
        workspace_id: cfg.workspaceId,
        ledger_schema: cfg.ledgerSchema,
        job_id: created.id,
        final_url: finalUrl,
        page_title: result.pageTitle || status.result?.pageTitle || null,
        auth_mode: authMode,
        extracted_bytes: extractedText.length
      },
      metrics: {
        ingested: 1,
        book_ingested: 1,
        ledger_ingested: 1,
        extracted_bytes: extractedText.length,
        steps: status.progress?.step ?? null,
        max_steps: status.progress?.maxSteps ?? null
      },
      card_updates: {
        params: {
          smartcursor_workspace_id: cfg.workspaceId
        }
      },
      logs: [
        {
          level: 'info',
          message: `smartcursor link ingestion completed for ${source_input}`,
          data: {
            workspaceId: cfg.workspaceId,
            ledgerSchema: cfg.ledgerSchema,
            jobId: created.id,
            steps: status.progress?.step ?? null
          }
        }
      ]
    };
  }
};
