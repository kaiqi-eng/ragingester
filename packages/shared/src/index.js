export const SOURCE_TYPES = {
  HTTP_API: 'http_api',
  WEBSITE_URL: 'website_url',
  RSS_FEED: 'rss_feed',
  IDENTIFIER_BASED: 'identifier_based'
};

export const RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed'
};

export const TRIGGER_MODE = {
  MANUAL: 'manual',
  SCHEDULED: 'scheduled'
};

export const DEFAULT_TIMEZONE = 'America/Chicago';

/**
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} owner_id
 * @property {string} source_type
 * @property {string} source_input
 * @property {Record<string, any>} params
 * @property {boolean} schedule_enabled
 * @property {string | null} cron_expression
 * @property {string} timezone
 * @property {string | null} next_run_at
 * @property {string | null} last_run_at
 * @property {number | null} run_timeout_ms
 * @property {number | null} run_max_retries
 * @property {boolean} active
 */
