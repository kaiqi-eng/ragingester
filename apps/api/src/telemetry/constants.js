/** Default / RSS subsystem tag (back-compat). */
export const TELEMETRY_SYSTEM = 'genie_rss';

/** Allowed daily-status / pipeline-error system tags. */
export const TELEMETRY_SYSTEMS = Object.freeze({
  RSS: 'genie_rss',
  YOUTUBE: 'genie_youtube',
  LINKEDIN: 'genie_linkedin'
});

export const TELEMETRY_SYSTEM_LIST = Object.freeze([
  TELEMETRY_SYSTEMS.RSS,
  TELEMETRY_SYSTEMS.YOUTUBE,
  TELEMETRY_SYSTEMS.LINKEDIN
]);

/** Source types that emit daily status + pipeline errors. */
export const TELEMETRY_SOURCE_TYPES = Object.freeze(['rss_feed', 'youtube', 'linkedin']);

/** Map source_type → system tag. */
export const SYSTEM_BY_SOURCE_TYPE = Object.freeze({
  rss_feed: TELEMETRY_SYSTEMS.RSS,
  youtube: TELEMETRY_SYSTEMS.YOUTUBE,
  linkedin: TELEMETRY_SYSTEMS.LINKEDIN
});

/** Map system tag → source_type. */
export const SOURCE_TYPE_BY_SYSTEM = Object.freeze({
  [TELEMETRY_SYSTEMS.RSS]: 'rss_feed',
  [TELEMETRY_SYSTEMS.YOUTUBE]: 'youtube',
  [TELEMETRY_SYSTEMS.LINKEDIN]: 'linkedin'
});

/** Bays-shaped Workflow labels by source_type. */
export const BAYS_WORKFLOW_BY_SOURCE_TYPE = Object.freeze({
  rss_feed: 'Genie_RSS',
  youtube: 'Genie_YouTube',
  linkedin: 'Genie_LinkedIn'
});

/** @deprecated Prefer BAYS_WORKFLOW_BY_SOURCE_TYPE.rss_feed */
export const BAYS_WORKFLOW_NAME = BAYS_WORKFLOW_BY_SOURCE_TYPE.rss_feed;

/** Slack header prefix by system (before `, {date}`). */
export const STATUS_HEADER_BY_SYSTEM = Object.freeze({
  [TELEMETRY_SYSTEMS.RSS]: 'RSS Daily Status',
  [TELEMETRY_SYSTEMS.YOUTUBE]: 'YouTube Daily Status',
  [TELEMETRY_SYSTEMS.LINKEDIN]: 'LinkedIn Daily Status'
});

/** Max length of failure `code` text shown in Slack Block Kit (full text stays in JSON). */
export const SLACK_FAILURE_CODE_MAX_LENGTH = 120;

/** Env names for telemetry config. Status channel is separate from `#bha-pipeline-errors`. */
export const TELEMETRY_ENV = {
  DAILY_STATUS_ENABLED: 'TELEMETRY_DAILY_STATUS_ENABLED',
  STATUS_YOUTUBE_ENABLED: 'TELEMETRY_STATUS_YOUTUBE_ENABLED',
  STATUS_LINKEDIN_ENABLED: 'TELEMETRY_STATUS_LINKEDIN_ENABLED',
  STATUS_SLACK_CHANNEL_ID: 'TELEMETRY_STATUS_SLACK_CHANNEL_ID',
  STATUS_SLACK_WEBHOOK_URL: 'TELEMETRY_STATUS_SLACK_WEBHOOK_URL',
  PIPELINE_ERRORS_ENABLED: 'TELEMETRY_PIPELINE_ERRORS_ENABLED',
  PIPELINE_ERRORS_SLACK_CHANNEL_ID: 'TELEMETRY_PIPELINE_ERRORS_SLACK_CHANNEL_ID',
  PIPELINE_ERRORS_SLACK_WEBHOOK_URL: 'TELEMETRY_PIPELINE_ERRORS_SLACK_WEBHOOK_URL',
  PIPELINE_ERRORS_MENTION: 'TELEMETRY_PIPELINE_ERRORS_MENTION',
  SLACK_TIMEOUT_MS: 'TELEMETRY_SLACK_TIMEOUT_MS'
};

/**
 * @param {string} sourceType
 * @returns {boolean}
 */
export function isTelemetrySourceType(sourceType) {
  return TELEMETRY_SOURCE_TYPES.includes(sourceType);
}

/**
 * @param {string} system
 * @returns {boolean}
 */
export function isAllowedTelemetrySystem(system) {
  return TELEMETRY_SYSTEM_LIST.includes(system);
}

/**
 * @param {string} sourceType
 * @returns {string}
 */
export function systemForSourceType(sourceType) {
  const system = SYSTEM_BY_SOURCE_TYPE[sourceType];
  if (!system) {
    throw new Error(`unsupported telemetry source_type: ${sourceType}`);
  }
  return system;
}

/**
 * @param {string} system
 * @returns {string}
 */
export function sourceTypeForSystem(system) {
  const sourceType = SOURCE_TYPE_BY_SYSTEM[system];
  if (!sourceType) {
    throw new Error(`unsupported telemetry system: ${system}`);
  }
  return sourceType;
}

/**
 * @param {string} sourceType
 * @returns {string}
 */
export function workflowForSourceType(sourceType) {
  const workflow = BAYS_WORKFLOW_BY_SOURCE_TYPE[sourceType];
  if (!workflow) {
    throw new Error(`unsupported telemetry source_type: ${sourceType}`);
  }
  return workflow;
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {string} [system]
 * @returns {string}
 */
export function buildDailyRunId(date, system = TELEMETRY_SYSTEM) {
  return `${system}:${date}`;
}
