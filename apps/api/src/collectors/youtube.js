import { config } from '../config.js';

const WORKSPACE_SLUG = 'youtube-feed';
const WORKSPACE_NAME = 'YouTube Feed';

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

function normalizeYoutubeSourceInput(sourceInput) {
  const value = String(sourceInput || '').trim();
  if (!value) {
    throw new Error('youtube source_input is required');
  }

  if (/^UC[\w-]{22}$/.test(value)) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${value}`;
  }

  try {
    const parsed = new URL(value);
    const isYoutubeHost = ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(parsed.hostname);
    const isFeedPath = parsed.pathname === '/feeds/videos.xml';
    const channelId = parsed.searchParams.get('channel_id');
    if (isYoutubeHost && isFeedPath && channelId && /^UC[\w-]{22}$/.test(channelId)) {
      return parsed.toString();
    }
    const channelPathMatch = parsed.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/);
    if (isYoutubeHost && parsed.protocol === 'https:' && channelPathMatch) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelPathMatch[1]}`;
    }
    if (isYoutubeHost && parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // handled below
  }

  throw new Error('youtube source_input must be a YouTube channel ID (UC...), YouTube feed URL, or https:// YouTube link');
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
    workspaceId: pickParam(params, 'youtube_workspace_id', null),
    cursor: asIsoDate(params.youtube_cursor_pub_date)
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
    'TAGs: [YOUTUBE]',
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
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(`request failed (${response.status}) for ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function fetchYoutubeFeed({ sourceInput, cfg, since }) {
  if (!cfg.genieRssApiKey) {
    throw new Error('GENIE_RSS_API_KEY is required for youtube ingestion');
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

async function listBharagWorkspaces({ cfg, limit = 100, offset = 0 }) {
  if (!cfg.bharagMasterApiKey) {
    throw new Error('BHARAG_MASTER_API_KEY is required for youtube ingestion');
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
      name: cfg.bharagOwnerName || 'Ragingester YouTube Owner',
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
    throw new Error('failed to create Bharag workspace for youtube ingestion');
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
    project_tags: ['youtube'],
    metadata: {
      ingestion_type: 'youtube',
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

export const youtubeCollector = {
  id: 'youtube',
  async collect({ source_input, params = {}, context = {} }) {
    const normalizedInput = normalizeYoutubeSourceInput(source_input);
    const cfg = resolveIntegrationConfig(params);
    const previousRun = cfg.cursor;
    const runTimestamp = new Date().toISOString();

    const feedResponse = await fetchYoutubeFeed({
      sourceInput: normalizedInput,
      cfg,
      since: previousRun
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
          sourceInput: normalizedInput,
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
      throw new Error(`failed to ingest YouTube items: ${failedItems[0].error}`);
    }

    const maxIngestedPubDate = ingestedItems
      .map((item) => item.pubDate)
      .filter(Boolean)
      .sort()
      .at(-1) || previousRun;

    return {
      raw: {
        source: feedResponse.source || 'discovered',
        feedUrl: feedResponse.feedUrl || normalizedInput,
        fetched: parsedItems.length,
        selected: newItems.length
      },
      normalized: {
        source_type: 'youtube',
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
          youtube_cursor_pub_date: maxIngestedPubDate,
          youtube_workspace_id: workspaceId
        }
      },
      logs: [
        {
          level: 'info',
          message: `youtube ingestion completed for ${normalizedInput}`,
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
          message: `youtube item ingestion failed: ${item.title}`,
          data: item
        }))
      ]
    };
  }
};

