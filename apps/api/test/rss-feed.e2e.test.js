import test from 'node:test';
import assert from 'node:assert/strict';
import { rssFeedCollector } from '../src/collectors/rss-feed.js';
import { config } from '../src/config.js';

const required = [
  'GENIE_RSS_API_KEY',
  'BHARAG_RSS_WORKSPACE_ID',
  'BHARAG_RSS_WORKSPACE_API_KEY'
];
const missing = required.filter((key) => !process.env[key]);
const runEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.RUN_RSS_E2E || '').toLowerCase());
const skipReason = !runEnabled
  ? 'RUN_RSS_E2E is not enabled'
  : missing.length
    ? `missing required env vars: ${missing.join(', ')}`
    : false;

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isUpstreamBillingOrQuotaError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return (
    text.includes('credit_balance_exhausted')
    || text.includes('no credits remaining')
    || text.includes('insufficient_quota')
    || text.includes('billing')
    || /(?:^|\D)429(?:\D|$)/.test(text)
  );
}

test(
  'e2e: Genie-RSS dual-writes Book and Ledger through the provisioned BHARAG2 workspace',
  { skip: skipReason },
  async (t) => {
    const originalFetch = global.fetch;
    const originalConfig = {
      bharagRssWorkspaceId: config.bharagRssWorkspaceId,
      bharagRssWorkspaceApiKey: config.bharagRssWorkspaceApiKey,
      bharagRssLedgerSchema: config.bharagRssLedgerSchema
    };
    const laneResponses = [];

    Object.assign(config, {
      bharagRssWorkspaceId: process.env.BHARAG_RSS_WORKSPACE_ID,
      bharagRssWorkspaceApiKey: process.env.BHARAG_RSS_WORKSPACE_API_KEY,
      bharagRssLedgerSchema: process.env.BHARAG_RSS_LEDGER_SCHEMA || 'ingest.rss'
    });
    global.fetch = async (url, options = {}) => {
      const response = await originalFetch(url, options);
      if (String(url).endsWith('/api/v1/ingest')) {
        laneResponses.push({
          payloadType: options.headers?.['payload-type'],
          status: response.status
        });
      }
      return response;
    };

    try {
      const result = await rssFeedCollector.collect({
        source_input: process.env.RSS_E2E_FEED_URL || 'https://techcrunch.com/feed/',
        params: {
          genie_rss_base_url: trimTrailingSlash(process.env.GENIE_RSS_BASE_URL || 'https://genie-rss-5i00.onrender.com'),
          genie_rss_api_key: process.env.GENIE_RSS_API_KEY,
          bharag_base_url: trimTrailingSlash(process.env.BHARAG_BASE_URL || 'https://bharag2.duckdns.org')
        },
        context: { triggerMode: 'manual' }
      });

      assert.ok(result.metrics.fetched > 0, 'expected fetched RSS items');
      assert.ok(result.metrics.ingested > 0, 'expected at least one completed Book/Ledger pair');
      assert.equal(result.metrics.book_ingested, result.metrics.ingested);
      assert.equal(result.metrics.ledger_ingested, result.metrics.ingested);
      assert.equal(laneResponses.length, result.metrics.ingested * 2);
      assert.ok(laneResponses.every((response) => response.status >= 200 && response.status < 300));
      assert.deepEqual(
        [...new Set(laneResponses.map((response) => response.payloadType))].sort(),
        ['ledger', 'rag']
      );
    } catch (error) {
      if (isUpstreamBillingOrQuotaError(error)) {
        t.skip(`upstream billing/quota blocked live e2e: ${error.message}`);
        return;
      }
      throw error;
    } finally {
      global.fetch = originalFetch;
      Object.assign(config, originalConfig);
    }
  }
);
