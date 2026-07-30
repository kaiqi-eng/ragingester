/**
 * @typedef {Object} FailureEvent
 * @property {string} feed
 * @property {string} code
 * @property {string | null | undefined} [timestamp]
 */

/**
 * @typedef {Object} GroupedFailure
 * @property {string} feed
 * @property {string} code
 * @property {number} count
 * @property {string | null} first_seen
 */

/**
 * Group failure events by (feed, code). earliest timestamp wins for first_seen.
 *
 * @param {FailureEvent[]} events
 * @returns {GroupedFailure[]}
 */
export function groupFailures(events) {
  const list = Array.isArray(events) ? events : [];
  /** @type {Map<string, GroupedFailure>} */
  const byKey = new Map();

  for (const event of list) {
    const feed = event?.feed == null ? '' : String(event.feed);
    const code = event?.code == null ? '' : String(event.code);
    const key = `${feed}\0${code}`;
    const timestamp = normalizeTimestamp(event?.timestamp);

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        feed,
        code,
        count: 1,
        first_seen: timestamp
      });
      continue;
    }

    existing.count += 1;
    existing.first_seen = earlierTimestamp(existing.first_seen, timestamp);
  }

  return [...byKey.values()];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const iso = String(value);
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * @param {string | null} a
 * @param {string | null} b
 * @returns {string | null}
 */
function earlierTimestamp(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}
