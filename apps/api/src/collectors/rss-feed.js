import { config } from '../config.js';

const WORKSPACE_SLUG = 'rss-feed';
const WORKSPACE_NAME = 'RSS Feed';
const GENIE_RSS_READY_WAIT_MS = 60 * 1000;
const GENIE_RSS_READY_RETRY_MS = 5 * 1000;
const RATE_LIMIT_INITIAL_RETRY_MS = 5 * 1000;
const RATE_LIMIT_MAX_RETRY_MS = 30 * 1000;

class RequestError extends Error {
  constructor(message, { status, retryAfterMs }) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

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

function resolveIntegrationConfig(params = {}) {
  return {
    genieRssBaseUrl: trimTrailingSlash(pickParam(params, 'genie_rss_base_url', config.genieRssBaseUrl)),
    genieRssApiKey: pickParam(params, 'genie_rss_api_key', config.genieRssApiKey),
    bharagBaseUrl: trimTrailingSlash(pickParam(params, 'bharag_base_url', config.bharagBaseUrl)),
    bharagMasterApiKey: pickParam(params, 'bharag_master_api_key', config.bharagMasterApiKey),
    bharagOwnerBuilderId: pickParam(params, 'bharag_owner_builder_id', config.bharagOwnerBuilderId),
    bharagOwnerName: pickParam(params, 'bharag_owner_name', config.bharagOwnerName),
    bharagOwnerEmail: pickParam(params, 'bharag_owner_email', config.bharagOwnerEmail),
    workspaceId: pickParam(params, 'rss_workspace_id', null),
    cursor: asIsoDate(params.rss_cursor_pub_date)
  };
}

function parseFeedItems(feed) {
  if (!feed || !Array.isArray(feed.items)) return [];
  return feed.items.map((item) => ({
    title: item.title || 'Untitled',
    content: item.content || item.contentSnippet || '',
    link: item.link || '',
    guid: item.guid || item.link || null,
    pubDate: asIsoDate(item.pubDate || item.isoDate)
  }));
}

function buildDocumentContent({ runTimestamp, previousRun, item }) {
  return [
    'TAGs: [RSS]',
    `Timestamp ran: ${runTimestamp}`,
    `Previous run: ${previousRun || 'none'}`,
    `Post timestamp: ${item.pubDate || 'unknown'}`,
    `Title: ${item.title}`,
    `Content: ${item.content}`,
    `Link: ${item.link}`
  ].join('\n');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new RequestError(`request failed (${response.status}) for ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`, {
      status: response.status,
      retryAfterMs
    });
  }

  return body;
}

function parseRetryAfterMs(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = new Date(value).getTime();
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTooManyRequestsError(error) {
  return error?.status === 429 || String(error instanceof Error ? error.message : error).includes('(429)');
}

async function fetchRssFeed({ sourceInput, cfg, since }) {
  if (!cfg.genieRssApiKey) {
    throw new Error('GENIE_RSS_API_KEY is required for rss_feed ingestion');
  }

  const payload = { url: sourceInput };
  if (since) payload.since = since;

  return fetchJson(`${cfg.genieRssBaseUrl}/api/rss/fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.genieRssApiKey
    },
    body: JSON.stringify(payload)
  });
}

function getRateLimitRetryMs(error, attempt, { initialRetryMs, maxRetryMs }) {
  if (Number.isFinite(error?.retryAfterMs)) {
    return error.retryAfterMs;
  }

  return Math.min(maxRetryMs, initialRetryMs * (2 ** Math.max(0, attempt - 1)));
}

async function fetchRssFeedWithRateLimitBackoff({
  sourceInput,
  cfg,
  since,
  timeoutMs,
  initialRetryMs = RATE_LIMIT_INITIAL_RETRY_MS,
  maxRetryMs = RATE_LIMIT_MAX_RETRY_MS
}) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      return await fetchRssFeed({ sourceInput, cfg, since });
    } catch (error) {
      if (!isTooManyRequestsError(error)) {
        throw error;
      }
      lastError = error;
      attempt += 1;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const retryMs = getRateLimitRetryMs(error, attempt, { initialRetryMs, maxRetryMs });
      await sleep(Math.min(retryMs, remainingMs));
    }
  }

  if (lastError) throw lastError;
  return fetchRssFeed({ sourceInput, cfg, since });
}

async function listBharagWorkspaces({ cfg, limit = 100, offset = 0 }) {
  if (!cfg.bharagMasterApiKey) {
    throw new Error('BHARAG_MASTER_API_KEY is required for rss_feed ingestion');
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
      name: cfg.bharagOwnerName || 'Ragingester RSS Owner',
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
    // If already a member, promote via update endpoint.
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
    throw new Error('failed to create Bharag workspace for rss-feed ingestion');
  }
  const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: created.workspace.id });
  return { workspaceId: created.workspace.id, ownerBuilderId };
}

async function ingestDocument({ cfg, workspaceId, sourceInput, item, runTimestamp, previousRun }) {
  const body = {
    title: item.title,
    content: buildDocumentContent({
      runTimestamp,
      previousRun,
      item
    }),
    source_type: 'manual',
    content_type: 'doc',
    source_url: item.link || sourceInput,
    project_tags: ['rss'],
    metadata: {
      ingestion_type: 'rss_feed',
      feed_source: sourceInput,
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

export async function prewarmRssFeed({
  params = {},
  waitMs = GENIE_RSS_READY_WAIT_MS,
  retryMs = GENIE_RSS_READY_RETRY_MS
} = {}) {
  const cfg = resolveIntegrationConfig(params);
  if (!cfg.genieRssApiKey) {
    throw new Error('GENIE_RSS_API_KEY is required for rss_feed prewarm');
  }

  const deadline = Date.now() + waitMs;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      await fetchJson(`${cfg.genieRssBaseUrl}/health`, {
        headers: {
          'x-api-key': cfg.genieRssApiKey
        }
      });
      return;
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(retryMs, remainingMs));
    }
  }

  throw lastError || new Error('GENIE RSS service was not ready');
}

export const rssFeedCollector = {
  id: 'rss_feed',
  async collect({ source_input, params = {}, context = {} }) {
    const cfg = resolveIntegrationConfig(params);
    const previousRun = cfg.cursor;
    const runTimestamp = new Date().toISOString();

    await prewarmRssFeed({ params });

    const feedResponse = await fetchRssFeedWithRateLimitBackoff({
      sourceInput: source_input,
      cfg,
      since: previousRun,
      timeoutMs: context.timeoutMs || config.runTimeoutMs,
      initialRetryMs: context.rateLimitInitialRetryMs || RATE_LIMIT_INITIAL_RETRY_MS,
      maxRetryMs: context.rateLimitMaxRetryMs || RATE_LIMIT_MAX_RETRY_MS
    });

    const parsedItems = parseFeedItems(feedResponse.feed);
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
          sourceInput: source_input,
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
      throw new Error(`failed to ingest RSS items: ${failedItems[0].error}`);
    }

    const maxIngestedPubDate = ingestedItems
      .map((item) => item.pubDate)
      .filter(Boolean)
      .sort()
      .at(-1) || previousRun;

    return {
      raw: {
        source: feedResponse.source || 'discovered',
        feedUrl: feedResponse.feedUrl || source_input,
        fetched: parsedItems.length,
        selected: newItems.length
      },
      normalized: {
        source_type: 'rss_feed',
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
          rss_cursor_pub_date: maxIngestedPubDate,
          rss_workspace_id: workspaceId
        }
      },
      logs: [
        {
          level: 'info',
          message: `rss ingestion completed for ${source_input}`,
          data: {
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
          message: `rss item ingestion failed: ${item.title}`,
          data: item
        }))
      ]
    };
  }
};
