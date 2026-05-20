import { config } from '../config.js';

const WORKSPACE_SLUG = 'slack-engine-fetch';
const WORKSPACE_NAME = 'Slack Engine Fetch';

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
    slackEngineBaseUrl: trimTrailingSlash(pickParam(params, 'slack_engine_base_url', config.slackEngineBaseUrl)),
    slackEngineApiKey: pickParam(params, 'slack_engine_api_key', config.slackEngineApiKey),
    bharagBaseUrl: trimTrailingSlash(pickParam(params, 'bharag_base_url', config.bharagBaseUrl)),
    bharagMasterApiKey: pickParam(params, 'bharag_master_api_key', config.bharagMasterApiKey),
    bharagOwnerBuilderId: pickParam(params, 'bharag_owner_builder_id', config.bharagOwnerBuilderId),
    bharagOwnerName: pickParam(params, 'bharag_owner_name', config.bharagOwnerName),
    bharagOwnerEmail: pickParam(params, 'bharag_owner_email', config.bharagOwnerEmail),
    workspaceId: pickParam(params, 'slack_engine_workspace_id', null)
  };
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

function getTimezoneDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return { year, month, day };
}

function formatPreviousDayInTimezone(timezone, fromDate = new Date()) {
  const { year, month, day } = getTimezoneDateParts(fromDate, timezone || 'America/Chicago');
  const tzDateAsUtc = new Date(Date.UTC(year, month - 1, day));
  tzDateAsUtc.setUTCDate(tzDateAsUtc.getUTCDate() - 1);
  const yyyy = String(tzDateAsUtc.getUTCFullYear());
  const mm = String(tzDateAsUtc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(tzDateAsUtc.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function listBharagWorkspaces({ cfg, limit = 100, offset = 0 }) {
  if (!cfg.bharagMasterApiKey) {
    throw new Error('BHARAG_MASTER_API_KEY is required for slack_engine_fetch ingestion');
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
      name: cfg.bharagOwnerName || 'Ragingester Slack Engine Owner',
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
    throw new Error('failed to create Bharag workspace for slack_engine_fetch ingestion');
  }
  const ownerBuilderId = await ensureWorkspaceHasOwner({ cfg, workspaceId: created.workspace.id });
  return { workspaceId: created.workspace.id, ownerBuilderId };
}

async function fetchSlackEngineDailyCapture({ cfg, channelName, date }) {
  const endpoint = `${cfg.slackEngineBaseUrl}/webhook/slack-engine/fetch`;
  const url = new URL(endpoint);
  url.searchParams.set('channel', channelName);
  url.searchParams.set('date', date);

  try {
    return await fetchJson(url.toString(), {
      headers: {
        'x-api-key': cfg.slackEngineApiKey
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`slack_engine_fetch failed for channel=${channelName} date=${date}: ${message}`);
  }
}

async function ingestDocument({ cfg, workspaceId, title, content, sourceUrl, metadata }) {
  return fetchJson(`${cfg.bharagBaseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.bharagMasterApiKey,
      'x-workspace-id': workspaceId
    },
    body: JSON.stringify({
      title,
      content,
      source_type: 'manual',
      content_type: 'doc',
      source_url: sourceUrl,
      project_tags: ['slack', 'daily-capture'],
      metadata
    })
  });
}

export const slackEngineFetchCollector = {
  id: 'slack_engine_fetch',
  async collect({ source_input, params = {}, context = {} }) {
    const channelName = String(source_input || '').trim();
    if (!channelName) {
      throw new Error('slack_engine_fetch source_input is required');
    }

    const cfg = resolveIntegrationConfig(params);
    if (!cfg.slackEngineApiKey) {
      throw new Error('SLACK_ENGINE_API_KEY is required for slack_engine_fetch ingestion');
    }
    if (!cfg.bharagMasterApiKey) {
      throw new Error('BHARAG_MASTER_API_KEY is required for slack_engine_fetch ingestion');
    }

    const timezone = context?.card?.timezone || 'America/Chicago';
    const fetchDate = formatPreviousDayInTimezone(timezone);
    const response = await fetchSlackEngineDailyCapture({ cfg, channelName, date: fetchDate });
    const content = typeof response.content === 'string' ? response.content : '';
    if (!content.trim()) {
      throw new Error(`slack_engine_fetch returned empty content for channel=${channelName} date=${fetchDate}`);
    }

    const { workspaceId, ownerBuilderId } = await resolveWorkspaceId(cfg);
    const fallbackSourceUrl = `${cfg.slackEngineBaseUrl}/webhook/slack-engine/fetch?channel=${encodeURIComponent(channelName)}&date=${encodeURIComponent(fetchDate)}`;
    const docUrl = response.doc_url || fallbackSourceUrl;
    const title = `Slack daily capture: #${response.channel_name || channelName} (${response.date || fetchDate})`;

    await ingestDocument({
      cfg,
      workspaceId,
      title,
      content,
      sourceUrl: docUrl,
      metadata: {
        ingestion_type: 'slack_engine_fetch',
        channel_name: response.channel_name || channelName,
        channel_id: response.channel_id || null,
        date: response.date || fetchDate,
        doc_url: response.doc_url || null,
        trigger_mode: context.triggerMode || null
      }
    });

    return {
      raw: response,
      normalized: {
        source_type: 'slack_engine_fetch',
        trigger_mode: context.triggerMode || null,
        workspace_slug: WORKSPACE_SLUG,
        workspace_id: workspaceId,
        owner_builder_id: ownerBuilderId || null,
        channel_name: response.channel_name || channelName,
        channel_id: response.channel_id || null,
        fetched_date: response.date || fetchDate,
        doc_url: response.doc_url || null,
        content_bytes: content.length
      },
      metrics: {
        ingested: 1,
        content_bytes: content.length
      },
      card_updates: {
        params: {
          slack_engine_workspace_id: workspaceId,
          slack_engine_last_date: response.date || fetchDate
        }
      },
      logs: [
        {
          level: 'info',
          message: `slack engine ingestion completed for ${channelName} (${response.date || fetchDate})`,
          data: {
            workspaceId,
            ownerBuilderId: ownerBuilderId || null,
            channel: response.channel_name || channelName,
            date: response.date || fetchDate
          }
        }
      ]
    };
  }
};
