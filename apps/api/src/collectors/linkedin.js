import { config } from '../config.js';

const WORKSPACE_SLUG = 'linkedin-feed';
const WORKSPACE_NAME = 'LinkedIn Feed';

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function asIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickParam(params, key, fallback) {
  const value = params?.[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function pickNumber(params, key, fallback) {
  const value = params?.[key];
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer`);
  }
  return parsed;
}

function pickBoolean(params, key, fallback) {
  const value = params?.[key];
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  throw new Error(`${key} must be a boolean`);
}

function pickStringArray(params, key) {
  const value = params?.[key];
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }
  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function parseSearchQueries(sourceInput, params = {}) {
  const fromParams = pickStringArray(params, 'searchQueries');
  if (fromParams) return fromParams;

  const fromInput = String(sourceInput || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromInput.length) return fromInput;

  throw new Error('linkedin topic mode requires params.searchQueries or comma-separated source_input');
}

function normalizeLinkedinProfileUrl(sourceInput) {
  const value = String(sourceInput || '').trim();
  if (!value) {
    throw new Error('linkedin source_input is required');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('linkedin profile source_input must be a valid LinkedIn profile or company URL');
  }

  const isLinkedinHost = parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com');
  const isProfilePath = /^\/(in|company)\/[^/]+\/?$/.test(parsed.pathname);
  if (!isLinkedinHost || parsed.protocol !== 'https:' || !isProfilePath) {
    throw new Error('linkedin profile source_input must be an https:// linkedin.com/in/... or linkedin.com/company/... URL');
  }

  return parsed.toString();
}

function normalizeLinkedinRequest(sourceInput, params = {}) {
  const mode = pickParam(params, 'linkedin_mode', 'profile').toLowerCase();

  if (mode === 'profile') {
    return {
      mode,
      sourceInput: normalizeLinkedinProfileUrl(sourceInput),
      endpoint: '/api/linkedin/profile-posts',
      payload: {
        profileUrl: normalizeLinkedinProfileUrl(sourceInput),
        maxPosts: pickNumber(params, 'maxPosts', 10)
      }
    };
  }

  if (mode !== 'topic') {
    throw new Error('linkedin_mode must be either "profile" or "topic"');
  }

  const contentType = pickParam(params, 'contentType', 'all');
  if (!['all', 'posts', 'articles'].includes(contentType)) {
    throw new Error('contentType must be one of: all, posts, articles');
  }

  const payload = {
    searchQueries: parseSearchQueries(sourceInput, params),
    contentType,
    maxPosts: pickNumber(params, 'maxPosts', 20),
    maxReactions: pickNumber(params, 'maxReactions', 5),
    postNestedComments: pickBoolean(params, 'postNestedComments', false),
    postNestedReactions: pickBoolean(params, 'postNestedReactions', false),
    scrapeComments: pickBoolean(params, 'scrapeComments', false),
    scrapeReactions: pickBoolean(params, 'scrapeReactions', false)
  };

  const authorUrls = pickStringArray(params, 'authorUrls');
  if (authorUrls) payload.authorUrls = authorUrls;

  const authorsCompanies = pickStringArray(params, 'authorsCompanies');
  if (authorsCompanies) payload.authorsCompanies = authorsCompanies;

  return {
    mode,
    sourceInput: payload.searchQueries.join(', '),
    endpoint: '/api/linkedin/topic-posts',
    payload
  };
}

function resolveIntegrationConfig(params = {}) {
  return {
    genieRssBaseUrl: trimTrailingSlash(pickParam(params, 'genie_rss_base_url', config.genieRssBaseUrl)),
    genieRssApiKey: pickParam(params, 'genie_rss_api_key', config.genieRssApiKey),
    bharagBaseUrl: trimTrailingSlash(pickParam(params, 'bharag_base_url', config.bharagBaseUrl)),
    bharagMasterApiKey: pickParam(params, 'bharag_master_api_key', config.bharagMasterApiKey),
    bharagOwnerBuilderId: pickParam(params, 'bharag_owner_builder_id', config.bharagOwnerBuilderId),
    bharagOwnerName: pickParam(params, 'bharag_owner_name', config.bharagOwnerName),
    bharagOwnerEmail: pickParam(params, 'bharag_owner_email', config.bharagOwnerEmail),
    workspaceId: pickParam(params, 'linkedin_workspace_id', null),
    cursor: asIsoDate(params.linkedin_cursor_pub_date)
  };
}

function parseLinkedinItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    title: item.title || 'LinkedIn Post',
    content: item.content || '',
    link: item.source_url || '',
    guid: item.source_id || item.source_url || null,
    pubDate: asIsoDate(item.metadata?.pubDate),
    metadata: item.metadata || {}
  }));
}

function buildDocumentContent({ runTimestamp, previousRun, item }) {
  return [
    'TAGs: [LINKEDIN]',
    `Timestamp ran: ${runTimestamp}`,
    `Previous run: ${previousRun || 'none'}`,
    `Post timestamp: ${item.pubDate || 'unknown'}`,
    `Title: ${item.title}`,
    `Author: ${item.metadata.author || 'unknown'}`,
    `Reactions: ${item.metadata.reactions ?? 0}`,
    `Content: ${item.content}`,
    `Link: ${item.link}`
  ].join('\n');
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

async function fetchLinkedinPosts({ request, cfg }) {
  const headers = {
    'content-type': 'application/json'
  };
  if (cfg.genieRssApiKey) {
    headers['x-api-key'] = cfg.genieRssApiKey;
  }

  const response = await fetchJson(`${cfg.genieRssBaseUrl}${request.endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request.payload)
  });

  if (response?.success === false) {
    throw new Error(response.error || 'LinkedIn fetch failed');
  }

  if (!Array.isArray(response?.data)) {
    throw new Error('Invalid LinkedIn response from Genie-RSS');
  }

  return response;
}

async function listBharagWorkspaces({ cfg, limit = 100, offset = 0 }) {
  if (!cfg.bharagMasterApiKey) {
    throw new Error('BHARAG_MASTER_API_KEY is required for linkedin ingestion');
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
      name: cfg.bharagOwnerName || 'Ragingester LinkedIn Owner',
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
    throw new Error('failed to create Bharag workspace for linkedin ingestion');
  }
  const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: created.workspace.id });
  return { workspaceId: created.workspace.id, ownerBuilderId };
}

async function ingestDocument({ cfg, workspaceId, request, item, runTimestamp, previousRun }) {
  const body = {
    title: item.title,
    content: buildDocumentContent({
      runTimestamp,
      previousRun,
      item
    }),
    source_type: 'manual',
    content_type: 'doc',
    source_url: item.link || request.sourceInput,
    project_tags: ['linkedin'],
    metadata: {
      ...item.metadata,
      ingestion_type: 'linkedin',
      linkedin_mode: request.mode,
      feed_source: request.sourceInput,
      item_guid: item.guid,
      item_pub_date: item.pubDate
    }
  };

  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.bharagMasterApiKey,
      'x-workspace-id': workspaceId
    },
    body: JSON.stringify(body)
  });
}

export const linkedinCollector = {
  id: 'linkedin',
  async collect({ source_input, params = {}, context = {} }) {
    const request = normalizeLinkedinRequest(source_input, params);
    const cfg = resolveIntegrationConfig(params);
    const previousRun = cfg.cursor;
    const runTimestamp = new Date().toISOString();

    const postsResponse = await fetchLinkedinPosts({ request, cfg });
    const parsedItems = parseLinkedinItems(postsResponse.data);
    const newItems = previousRun
      ? parsedItems.filter((item) => item.pubDate && item.pubDate > previousRun)
      : parsedItems;

    const { workspaceId, ownerBuilderId } = await resolveWorkspaceId(cfg);

    const failedItems = [];
    const ingestedItems = [];

    for (const item of newItems) {
      try {
        await ingestDocument({
          cfg,
          workspaceId,
          request,
          item,
          runTimestamp,
          previousRun
        });
        ingestedItems.push(item);
      } catch (error) {
        failedItems.push({
          title: item.title,
          link: item.link,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (failedItems.length > 0 && ingestedItems.length === 0 && newItems.length > 0) {
      throw new Error(`failed to ingest LinkedIn items: ${failedItems[0].error}`);
    }

    const maxIngestedPubDate = ingestedItems
      .map((item) => item.pubDate)
      .filter(Boolean)
      .sort()
      .at(-1) || previousRun;

    return {
      raw: {
        mode: request.mode,
        endpoint: request.endpoint,
        fetched: parsedItems.length,
        selected: newItems.length
      },
      normalized: {
        source_type: 'linkedin',
        trigger_mode: context.triggerMode || null,
        workspace_slug: WORKSPACE_SLUG,
        workspace_id: workspaceId,
        owner_builder_id: ownerBuilderId || null,
        fetched_count: parsedItems.length,
        ingested_count: ingestedItems.length,
        skipped_count: parsedItems.length - newItems.length,
        failed_count: failedItems.length,
        previous_cursor: previousRun,
        next_cursor: maxIngestedPubDate
      },
      metrics: {
        fetched: parsedItems.length,
        selected: newItems.length,
        ingested: ingestedItems.length,
        failed: failedItems.length
      },
      card_updates: {
        params: {
          linkedin_cursor_pub_date: maxIngestedPubDate,
          linkedin_workspace_id: workspaceId
        }
      },
      logs: [
        {
          level: 'info',
          message: `linkedin ingestion completed for ${request.sourceInput}`,
          data: {
            mode: request.mode,
            fetched: parsedItems.length,
            selected: newItems.length,
            ingested: ingestedItems.length,
            failed: failedItems.length,
            workspaceId,
            ownerBuilderId: ownerBuilderId || null
          }
        },
        ...failedItems.map((item) => ({
          level: 'warn',
          message: `linkedin item ingestion failed: ${item.title}`,
          data: item
        }))
      ]
    };
  }
};
