import { RUN_STATUS } from '@ragingester/shared';
import {
  TELEMETRY_SYSTEM,
  SYSTEM_BY_SOURCE_TYPE,
  buildDailyRunId,
  sourceTypeForSystem,
  systemForSourceType
} from './constants.js';
import { classifyRun } from './classify.js';
import { groupFailures } from './group-failures.js';
import { listStatusEvents } from './local-status-log.js';
import { validateDailyStatus } from './validate.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} date YYYY-MM-DD
 * @returns {{ fromIso: string, toIso: string }}
 */
export function utcDayWindow(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const fromIso = `${date}T00:00:00.000Z`;
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const toIso = new Date(fromMs + 24 * 60 * 60 * 1000).toISOString();
  return { fromIso, toIso };
}

/**
 * Yesterday's UTC date as YYYY-MM-DD.
 * @param {Date} [now]
 * @returns {string}
 */
export function yesterdayUtcDate(now = new Date()) {
  const ms = now.getTime() - 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeMetric(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Build DailyStatus for a UTC calendar day from the local status log.
 *
 * Run history remains in collection_runs. This rollup only uses terminal
 * RSS / YouTube / LinkedIn events recorded as those runs finish.
 *
 * `feeds_active` counts distinct cards with at least one terminal run that day.
 *
 * @param {{
 *   repository?: object,
 *   date: string,
 *   sourceType?: string,
 *   system?: string
 * }} input
 * @returns {Promise<import('./validate.js').DailyStatus>}
 */
export async function buildDailyStatus({
  date,
  sourceType,
  system
}) {
  const resolvedSystem = system
    || (sourceType ? systemForSourceType(sourceType) : TELEMETRY_SYSTEM);
  const resolvedSourceType = sourceType
    || sourceTypeForSystem(resolvedSystem);

  const { fromIso } = utcDayWindow(date);
  const events = listStatusEvents({ date, sourceType: resolvedSourceType });

  const ingest = { ok: 0, degraded: 0, failed: 0 };
  const items = { fetched: 0, selected: 0, ingested: 0, failed: 0 };
  /** @type {Set<string>} */
  const cardsRan = new Set();
  /** @type {{ feed: string, code: string, timestamp: string | null }[]} */
  const failureEvents = [];
  let lastRunMs = null;

  for (const event of events) {
    if (event.status !== RUN_STATUS.SUCCESS && event.status !== RUN_STATUS.FAILED) {
      continue;
    }

    cardsRan.add(event.card_id || event.run_id);

    const runMetrics = {
      fetched: nonNegativeMetric(event.metrics?.fetched),
      selected: nonNegativeMetric(event.metrics?.selected),
      ingested: nonNegativeMetric(event.metrics?.ingested),
      failed: nonNegativeMetric(event.metrics?.failed)
    };
    items.fetched += runMetrics.fetched;
    items.selected += runMetrics.selected;
    items.ingested += runMetrics.ingested;
    items.failed += runMetrics.failed;

    const bucket = classifyRun({ status: event.status, failedCount: runMetrics.failed });
    ingest[bucket] += 1;

    const endedAt = event.ended_at || null;
    if (endedAt) {
      const endedMs = Date.parse(endedAt);
      if (!Number.isNaN(endedMs) && (lastRunMs == null || endedMs > lastRunMs)) {
        lastRunMs = endedMs;
      }
    }

    if (event.status === RUN_STATUS.FAILED) {
      failureEvents.push({
        feed: String(event.source_input || ''),
        code: event.error || 'unknown error',
        timestamp: endedAt
      });
    }
  }

  const runId = buildDailyRunId(date, resolvedSystem);
  const status = {
    system: resolvedSystem,
    run_id: runId,
    date,
    feeds_active: cardsRan.size,
    ingest,
    items,
    last_run: lastRunMs == null ? fromIso : new Date(lastRunMs).toISOString(),
    failures: groupFailures(failureEvents),
    link: runId
  };

  validateDailyStatus(status);
  return status;
}

/**
 * Build RssDailyStatus for a UTC calendar day (RSS-only wrapper).
 *
 * @param {{ repository?: object, date: string }} input
 * @returns {Promise<import('./validate.js').DailyStatus>}
 */
export async function buildRssDailyStatus({ repository, date }) {
  return buildDailyStatus({
    repository,
    date,
    sourceType: 'rss_feed',
    system: SYSTEM_BY_SOURCE_TYPE.rss_feed
  });
}
