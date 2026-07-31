import { isAllowedTelemetrySystem } from './constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {Object} DailyStatusFailure
 * @property {string} feed
 * @property {string} code
 * @property {number} count
 * @property {string | null} first_seen
 */

/**
 * @typedef {Object} DailyStatus
 * @property {string} system
 * @property {string} run_id
 * @property {string} date
 * @property {number} feeds_active
 * @property {{ ok: number, degraded: number, failed: number }} ingest
 * @property {string} last_run
 * @property {DailyStatusFailure[]} failures
 * @property {string} link
 */

/** @typedef {DailyStatus} RssDailyStatus */
/** @typedef {DailyStatusFailure} RssDailyStatusFailure */

/**
 * Validate daily status shape. Throws on first violation.
 *
 * @param {unknown} obj
 * @returns {asserts obj is DailyStatus}
 */
export function validateDailyStatus(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('DailyStatus must be an object');
  }

  /** @type {Record<string, unknown>} */
  const status = obj;

  if (typeof status.system !== 'string' || !isAllowedTelemetrySystem(status.system)) {
    throw new Error('system must be one of genie_rss, genie_youtube, genie_linkedin');
  }
  assertNonEmptyString(status.run_id, 'run_id');
  assertDate(status.date, 'date');
  assertNonNegativeInt(status.feeds_active, 'feeds_active');

  if (!status.ingest || typeof status.ingest !== 'object' || Array.isArray(status.ingest)) {
    throw new Error('ingest must be an object');
  }
  /** @type {Record<string, unknown>} */
  const ingest = status.ingest;
  assertNonNegativeInt(ingest.ok, 'ingest.ok');
  assertNonNegativeInt(ingest.degraded, 'ingest.degraded');
  assertNonNegativeInt(ingest.failed, 'ingest.failed');

  assertNonEmptyString(status.last_run, 'last_run');
  if (Number.isNaN(Date.parse(String(status.last_run)))) {
    throw new Error('last_run must be an ISO 8601 timestamp');
  }

  if (!Array.isArray(status.failures)) {
    throw new Error('failures must be an array');
  }
  for (let i = 0; i < status.failures.length; i += 1) {
    validateFailure(status.failures[i], i);
  }

  assertNonEmptyString(status.link, 'link');
}

/** @deprecated Prefer validateDailyStatus */
export const validateRssDailyStatus = validateDailyStatus;

/**
 * @param {unknown} failure
 * @param {number} index
 */
function validateFailure(failure, index) {
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) {
    throw new Error(`failures[${index}] must be an object`);
  }
  /** @type {Record<string, unknown>} */
  const row = failure;
  assertNonEmptyString(row.feed, `failures[${index}].feed`);
  assertNonEmptyString(row.code, `failures[${index}].code`);
  assertPositiveInt(row.count, `failures[${index}].count`);

  if (row.first_seen != null) {
    if (typeof row.first_seen !== 'string' || Number.isNaN(Date.parse(row.first_seen))) {
      throw new Error(`failures[${index}].first_seen must be an ISO timestamp or null`);
    }
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function assertDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function assertNonNegativeInt(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function assertPositiveInt(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}
