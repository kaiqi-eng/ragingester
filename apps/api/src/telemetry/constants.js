/** Subsystem tag on RSS daily status cards. */
export const TELEMETRY_SYSTEM = 'genie_rss';

/** Bays Error Handler workflow_name for the ragingester RSS lane. */
export const BAYS_WORKFLOW_NAME = 'Genie_RSS';

/** Max length of failure `code` text shown in Slack Block Kit (full text stays in JSON). */
export const SLACK_FAILURE_CODE_MAX_LENGTH = 120;

/**
 * Env names for later phases (not wired in Phase 0).
 * Status channel is separate from `#bha-pipeline-errors` / existing ALERTS_*.
 */
export const TELEMETRY_ENV = {
  DAILY_STATUS_ENABLED: 'TELEMETRY_DAILY_STATUS_ENABLED',
  STATUS_SLACK_CHANNEL_ID: 'TELEMETRY_STATUS_SLACK_CHANNEL_ID',
  STATUS_SLACK_WEBHOOK_URL: 'TELEMETRY_STATUS_SLACK_WEBHOOK_URL'
};

/**
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export function buildDailyRunId(date) {
  return `${TELEMETRY_SYSTEM}:${date}`;
}
