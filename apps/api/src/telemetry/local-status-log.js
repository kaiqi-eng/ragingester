import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { RUN_STATUS } from '@ragingester/shared';
import { isTelemetrySourceType } from './constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @type {string} */
let logDir = path.resolve(process.cwd(), '.telemetry', 'status-runs');
/** @type {boolean} */
let persistToDisk = true;
/** @type {Map<string, object>} */
const eventsByRunId = new Map();
/** @type {Set<string>} */
const loadedDates = new Set();

function utcDateFromTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function fileForDate(date) {
  return path.join(logDir, `${date}.jsonl`);
}

function remember(event) {
  if (!event?.run_id) return;
  eventsByRunId.set(event.run_id, event);
}

function parseJsonl(text) {
  if (!text) return;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      remember(JSON.parse(trimmed));
    } catch {
      // skip corrupt lines
    }
  }
}

function loadDateFromDisk(date) {
  if (!persistToDisk || loadedDates.has(date)) return;
  loadedDates.add(date);
  const filePath = fileForDate(date);
  if (!existsSync(filePath)) return;
  parseJsonl(readFileSync(filePath, 'utf8'));
}

/**
 * Record a terminal RSS / YouTube / LinkedIn run for the local daily-status log.
 * Full collection_runs / collected_data history stays in the database.
 *
 * @param {{
 *   runId?: string,
 *   cardId?: string,
 *   sourceType?: string,
 *   sourceInput?: string,
 *   status?: string,
 *   endedAt?: string,
 *   metrics?: { fetched?: number, selected?: number, ingested?: number, failed?: number },
 *   error?: string | null
 * }} input
 * @returns {object | null}
 */
export function recordStatusEvent(input = {}) {
  const sourceType = input.sourceType;
  if (!isTelemetrySourceType(sourceType)) return null;

  const status = input.status;
  if (status !== RUN_STATUS.SUCCESS && status !== RUN_STATUS.FAILED) return null;

  const endedAt = input.endedAt || new Date().toISOString();
  const date = utcDateFromTimestamp(endedAt);
  if (!date) return null;

  const event = {
    run_id: String(input.runId || `local:${date}:${eventsByRunId.size + 1}`),
    card_id: input.cardId ? String(input.cardId) : null,
    source_type: sourceType,
    source_input: input.sourceInput == null ? '' : String(input.sourceInput),
    status,
    ended_at: new Date(endedAt).toISOString(),
    metrics: {
      fetched: Number(input.metrics?.fetched) || 0,
      selected: Number(input.metrics?.selected) || 0,
      ingested: Number(input.metrics?.ingested) || 0,
      failed: Number(input.metrics?.failed) || 0
    },
    error: typeof input.error === 'string' && input.error ? input.error : null
  };

  remember(event);

  if (persistToDisk) {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(fileForDate(date), `${JSON.stringify(event)}\n`, 'utf8');
    loadedDates.add(date);
  }

  return event;
}

/**
 * @param {{ date: string, sourceType: string }} input
 * @returns {object[]}
 */
export function listStatusEvents({ date, sourceType }) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  if (persistToDisk) {
    loadedDates.delete(date);
    loadDateFromDisk(date);
  }

  return [...eventsByRunId.values()]
    .filter((event) => event.source_type === sourceType && utcDateFromTimestamp(event.ended_at) === date)
    .sort((left, right) => String(left.ended_at).localeCompare(String(right.ended_at)));
}

/**
 * Drop local status files older than the retained UTC dates (default: yesterday + today).
 *
 * @param {{ now?: Date, retainDates?: string[] }} [input]
 */
export function pruneStatusEvents({ now = new Date(), retainDates } = {}) {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const keep = new Set(retainDates || [today, yesterday]);

  for (const [runId, event] of eventsByRunId) {
    const date = utcDateFromTimestamp(event.ended_at);
    if (!keep.has(date)) eventsByRunId.delete(runId);
  }

  if (!persistToDisk) return;
  if (!existsSync(logDir)) return;
  for (const name of readdirSync(logDir)) {
    if (!name.endsWith('.jsonl')) continue;
    const date = name.slice(0, -'.jsonl'.length);
    if (keep.has(date)) continue;
    loadedDates.delete(date);
    unlinkSync(path.join(logDir, name));
  }
}

export function _resetLocalStatusLogForTests({ persist = false, directory } = {}) {
  eventsByRunId.clear();
  loadedDates.clear();
  persistToDisk = persist;
  if (directory) logDir = path.resolve(directory);
}

export function _setStatusLogDirForTests(directory) {
  logDir = path.resolve(directory);
  persistToDisk = true;
}
