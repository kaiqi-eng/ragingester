import { RUN_STATUS } from '@ragingester/shared';
import { TELEMETRY_SYSTEM, buildDailyRunId } from './constants.js';
import { classifyRun } from './classify.js';
import { groupFailures } from './group-failures.js';
import { validateRssDailyStatus } from './validate.js';

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
 * Build RssDailyStatus for a UTC calendar day from repository data.
 *
 * @param {{ repository: object, date: string }} input
 * @returns {Promise<import('./validate.js').RssDailyStatus>}
 */
export async function buildRssDailyStatus({ repository, date }) {
  const { fromIso, toIso } = utcDayWindow(date);
  const cards = await repository.listActiveRssFeedCards();
  const cardIds = cards.map((card) => card.id);
  const sourceByCardId = new Map(cards.map((card) => [card.id, card.source_input]));

  const runs = await repository.listRunsForCardsInWindow({ cardIds, fromIso, toIso });
  const runIds = runs.map((run) => run.id);
  const collectedRows = await repository.listCollectedDataByRunIds(runIds);
  const failedCountByRunId = new Map();
  for (const row of collectedRows) {
    const failed = Number(row?.metadata?.metrics?.failed);
    failedCountByRunId.set(row.run_id, Number.isFinite(failed) ? failed : 0);
  }

  const ingest = { ok: 0, degraded: 0, failed: 0 };
  /** @type {{ feed: string, code: string, timestamp: string | null }[]} */
  const failureEvents = [];
  let lastRunMs = null;

  for (const run of runs) {
    if (run.status !== RUN_STATUS.SUCCESS && run.status !== RUN_STATUS.FAILED) {
      continue;
    }

    const failedCount = failedCountByRunId.get(run.id) || 0;
    const bucket = classifyRun({ status: run.status, failedCount });
    ingest[bucket] += 1;

    const endedAt = run.ended_at || run.created_at || null;
    if (endedAt) {
      const endedMs = Date.parse(endedAt);
      if (!Number.isNaN(endedMs) && (lastRunMs == null || endedMs > lastRunMs)) {
        lastRunMs = endedMs;
      }
    }

    if (run.status === RUN_STATUS.FAILED) {
      const feed = sourceByCardId.get(run.card_id);
      if (!feed) continue;
      const code = resolveFailureCode(run);
      failureEvents.push({
        feed: String(feed),
        code,
        timestamp: endedAt
      });
    }
  }

  const runId = buildDailyRunId(date);
  const status = {
    system: TELEMETRY_SYSTEM,
    run_id: runId,
    date,
    feeds_active: cards.length,
    ingest,
    last_run: lastRunMs == null ? fromIso : new Date(lastRunMs).toISOString(),
    failures: groupFailures(failureEvents),
    link: runId
  };

  validateRssDailyStatus(status);
  return status;
}

/**
 * @param {{ error?: string | null, error_payload?: { message?: string } | null }} run
 * @returns {string}
 */
function resolveFailureCode(run) {
  const fromPayload = run?.error_payload?.message;
  if (typeof fromPayload === 'string' && fromPayload.length > 0) return fromPayload;
  if (typeof run?.error === 'string' && run.error.length > 0) return run.error;
  return 'unknown error';
}
