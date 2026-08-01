import {
  SLACK_FAILURE_CODE_MAX_LENGTH,
  STATUS_HEADER_BY_SYSTEM,
  TELEMETRY_SYSTEM
} from './constants.js';

/**
 * Truncate failure code for Slack display only. Full code stays in JSON payload.
 *
 * @param {string} code
 * @param {number} [maxLength]
 * @returns {string}
 */
export function truncateFailureCodeForSlack(code, maxLength = SLACK_FAILURE_CODE_MAX_LENGTH) {
  const text = code == null ? '' : String(code);
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return '…';
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Short prose summary of item volume for the Slack card.
 *
 * @param {{ fetched?: number, selected?: number, ingested?: number, failed?: number } | null | undefined} items
 * @returns {string}
 */
export function formatItemsSummary(items) {
  const fetched = Number(items?.fetched) || 0;
  const selected = Number(items?.selected) || 0;
  const ingested = Number(items?.ingested) || 0;
  const failed = Number(items?.failed) || 0;

  if (fetched === 0 && selected === 0 && ingested === 0 && failed === 0) {
    return 'No items fetched or ingested this day.';
  }

  return `Ingested ${ingested} of ${selected} selected items (${fetched} fetched, ${failed} item failures).`;
}

/**
 * Build Slack Block Kit blocks for a daily status card.
 *
 * @param {import('./validate.js').DailyStatus} status
 * @returns {{ blocks: object[] }}
 */
export function buildDailyStatusBlocks(status) {
  const headerPrefix = STATUS_HEADER_BY_SYSTEM[status?.system] || STATUS_HEADER_BY_SYSTEM[TELEMETRY_SYSTEM];
  const failures = Array.isArray(status?.failures) ? status.failures : [];
  const failuresText = failures.length === 0
    ? '*Failures:*\n_None_'
    : `*Failures:*\n${failures.map((failure) => {
      const code = truncateFailureCodeForSlack(failure.code);
      const firstSeen = failure.first_seen == null ? 'null' : failure.first_seen;
      return `• \`${failure.feed}\`, ${code}, ${failure.count} (${firstSeen})`;
    }).join('\n')}`;

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${headerPrefix}, ${status.date}`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Feeds ran:*\n${status.feeds_active}`
          },
          {
            type: 'mrkdwn',
            text: `*Ingest:*\nOK ${status.ingest.ok} | Degraded ${status.ingest.degraded} | Failed ${status.ingest.failed}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Items:*\n${formatItemsSummary(status.items)}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Last run: ${status.last_run}`
          }
        ]
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: failuresText
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Full run log: ${status.link}`
          }
        ]
      }
    ]
  };
}

/** @deprecated Prefer buildDailyStatusBlocks */
export const buildRssDailyStatusBlocks = buildDailyStatusBlocks;
