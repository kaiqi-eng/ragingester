import { config } from '../config.js';

const MIN_BOOK_CONTENT_LENGTH = 10;

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
    workspaceId: pickParam(params, 'bharag_youtube_workspace_id', config.bharagYoutubeWorkspaceId),
    workspaceApiKey: config.bharagYoutubeWorkspaceApiKey,
    ledgerSchema: pickParam(params, 'bharag_youtube_ledger_schema', config.bharagYoutubeLedgerSchema),
    cursor: asIsoDate(params.youtube_cursor_pub_date),
    cursorItemGuids: Array.isArray(params.youtube_cursor_item_guids)
      ? params.youtube_cursor_item_guids.filter((guid) => typeof guid === 'string' && guid.trim()).map((guid) => guid.trim())
      : []
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

function assertBharagYoutubeConfig(cfg) {
  if (!cfg.workspaceId) throw new Error('BHARAG_YOUTUBE_WORKSPACE_ID is required for youtube ingestion');
  if (!cfg.workspaceApiKey) throw new Error('BHARAG_YOUTUBE_WORKSPACE_API_KEY is required for youtube ingestion');
  if (!cfg.ledgerSchema) throw new Error('BHARAG_YOUTUBE_LEDGER_SCHEMA is required for youtube ingestion');
}

function validateItem(item) {
  if (!item.guid) return 'missing stable item GUID';
  if (!item.pubDate) return 'missing valid publication date';
  if (item.content.trim().length < MIN_BOOK_CONTENT_LENGTH) {
    return `video content must contain at least ${MIN_BOOK_CONTENT_LENGTH} characters`;
  }
  return null;
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

async function ingestBookDocument({ cfg, workspaceId, item }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: ingestHeaders(cfg, workspaceId, 'rag'),
    body: JSON.stringify({
      title: item.title,
      content: item.content.trim(),
      source_type: 'manual'
    })
  });
}

async function ingestLedgerEvent({ cfg, workspaceId, sourceInput, item }) {
  const sourceUrl = item.link || sourceInput;
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: ingestHeaders(cfg, workspaceId, 'ledger', cfg.ledgerSchema),
    body: JSON.stringify({
      occurred_at: item.pubDate,
      entity_type: 'document',
      entity_id: item.guid,
      source: sourceInput,
      summary: `YouTube item: ${item.title}`,
      payload: {
        source_type: 'manual',
        content_type: 'doc',
        source_url: sourceUrl,
        project_tags: ['youtube'],
        ingestion_type: 'youtube',
        feed_source: sourceInput,
        item_guid: item.guid,
        item_pub_date: item.pubDate
      }
    })
  });
}

export const youtubeCollector = {
  id: 'youtube',
  async collect({ source_input, params = {}, context = {} }) {
    const normalizedInput = normalizeYoutubeSourceInput(source_input);
    const cfg = resolveIntegrationConfig(params);
    const previousRun = cfg.cursor;
    assertBharagYoutubeConfig(cfg);

    const feedResponse = await fetchYoutubeFeed({
      sourceInput: normalizedInput,
      cfg,
      since: previousRun
    });

    const parsedItems = parseFeedItems(feedResponse.feed);
    const cursorItemGuids = new Set(cfg.cursorItemGuids);
    const newItems = previousRun
      ? parsedItems.filter((item) => (
        item.pubDate
        && (item.pubDate > previousRun || (item.pubDate === previousRun && !cursorItemGuids.has(item.guid)))
      ))
      : parsedItems;
    newItems.sort((left, right) => (
      (left.pubDate || '').localeCompare(right.pubDate || '')
      || (left.guid || '').localeCompare(right.guid || '')
    ));

    const failedItems = [];
    const ingestedItems = [];
    let bookIngestedCount = 0;
    let ledgerIngestedCount = 0;
    let nextCursor = previousRun;
    let nextCursorItemGuids = new Set(previousRun ? cfg.cursorItemGuids : []);

    for (const item of newItems) {
      const validationError = validateItem(item);
      if (validationError) {
        failedItems.push({ title: item.title, link: item.link, guid: item.guid, lane: 'validation', error: validationError });
        break;
      }

      try {
        await ingestBookDocument({ cfg, workspaceId: cfg.workspaceId, item });
        bookIngestedCount += 1;
      } catch (error) {
        failedItems.push({
          title: item.title,
          link: item.link,
          guid: item.guid,
          lane: 'book',
          error: error instanceof Error ? error.message : String(error)
        });
        break;
      }

      try {
        await ingestLedgerEvent({ cfg, workspaceId: cfg.workspaceId, sourceInput: normalizedInput, item });
        ledgerIngestedCount += 1;
        ingestedItems.push(item);
      } catch (error) {
        failedItems.push({
          title: item.title,
          link: item.link,
          guid: item.guid,
          lane: 'ledger',
          error: error instanceof Error ? error.message : String(error)
        });
        break;
      }

      if (!nextCursor || item.pubDate > nextCursor) {
        nextCursor = item.pubDate;
        nextCursorItemGuids = new Set([item.guid]);
      } else if (item.pubDate === nextCursor) {
        nextCursorItemGuids.add(item.guid);
      }
    }

    if (failedItems.length > 0 && ingestedItems.length === 0 && newItems.length > 0) {
      throw new Error(`failed to ingest YouTube items: ${failedItems[0].error}`);
    }

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
        workspace_id: cfg.workspaceId,
        ledger_schema: cfg.ledgerSchema,
        fetched_count: parsedItems.length,
        ingested_count: ingestedItems.length,
        book_ingested_count: bookIngestedCount,
        ledger_ingested_count: ledgerIngestedCount,
        skipped_count: parsedItems.length - newItems.length,
        failed_count: failedItems.length,
        previous_cursor: previousRun,
        next_cursor: nextCursor,
        next_cursor_item_guids: [...nextCursorItemGuids]
      },
      metrics: {
        fetched: parsedItems.length,
        selected: newItems.length,
        ingested: ingestedItems.length,
        failed: failedItems.length,
        book_ingested: bookIngestedCount,
        ledger_ingested: ledgerIngestedCount
      },
      card_updates: {
        params: {
          youtube_cursor_pub_date: nextCursor,
          youtube_cursor_item_guids: [...nextCursorItemGuids],
          youtube_workspace_id: cfg.workspaceId
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
            workspaceId: cfg.workspaceId,
            ledgerSchema: cfg.ledgerSchema,
            bookIngested: bookIngestedCount,
            ledgerIngested: ledgerIngestedCount
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

