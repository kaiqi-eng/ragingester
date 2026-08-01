import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDailyRunId,
  buildRssDailyStatusBlocks,
  classifyRun,
  formatItemsSummary,
  groupFailures,
  SLACK_FAILURE_CODE_MAX_LENGTH,
  TELEMETRY_SYSTEM,
  truncateFailureCodeForSlack,
  validateRssDailyStatus
} from '../src/telemetry/index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

test('classifyRun: success with zero item failures is ok', () => {
  assert.equal(classifyRun({ status: 'success', failedCount: 0 }), 'ok');
});

test('classifyRun: success with item failures is degraded', () => {
  assert.equal(classifyRun({ status: 'success', failedCount: 3 }), 'degraded');
});

test('classifyRun: failed status is failed', () => {
  assert.equal(classifyRun({ status: 'failed', failedCount: 0 }), 'failed');
});

test('classifyRun: non-terminal status throws', () => {
  assert.throws(
    () => classifyRun({ status: 'running' }),
    /terminal success\/failed/
  );
});

test('groupFailures: same feed+code aggregates count and earliest first_seen', () => {
  const grouped = groupFailures([
    {
      feed: 'https://techcrunch.com/feed/',
      code: 'run timed out after 30000ms',
      timestamp: '2026-07-26T10:00:00.000Z'
    },
    {
      feed: 'https://techcrunch.com/feed/',
      code: 'run timed out after 30000ms',
      timestamp: '2026-07-26T08:00:00.000Z'
    },
    {
      feed: 'https://www.theverge.com/rss/index.xml',
      code: 'different message',
      timestamp: '2026-07-26T09:00:00.000Z'
    }
  ]);

  assert.equal(grouped.length, 2);

  const tech = grouped.find((row) => row.feed.includes('techcrunch'));
  assert.deepEqual(tech, {
    feed: 'https://techcrunch.com/feed/',
    code: 'run timed out after 30000ms',
    count: 2,
    first_seen: '2026-07-26T08:00:00.000Z'
  });

  const verge = grouped.find((row) => row.feed.includes('theverge'));
  assert.equal(verge.count, 1);
  assert.equal(verge.code, 'different message');
});

test('groupFailures: missing timestamps yield null first_seen', () => {
  const grouped = groupFailures([
    { feed: 'https://example.com/feed.xml', code: 'boom' }
  ]);
  assert.equal(grouped[0].first_seen, null);
  assert.equal(grouped[0].count, 1);
});

test('validateRssDailyStatus: golden fixtures pass', () => {
  for (const name of [
    'status-all-ok.json',
    'status-mixed.json',
    'status-empty-failures.json',
    'status-long-code.json'
  ]) {
    assert.doesNotThrow(() => validateRssDailyStatus(loadFixture(name)), name);
  }
});

test('validateRssDailyStatus: bad system fails', () => {
  const status = loadFixture('status-all-ok.json');
  status.system = 'other';
  assert.throws(() => validateRssDailyStatus(status), /system must be/);
});

test('validateRssDailyStatus: missing field fails', () => {
  const status = loadFixture('status-all-ok.json');
  delete status.link;
  assert.throws(() => validateRssDailyStatus(status), /link must be/);
});

test('buildDailyRunId uses system prefix', () => {
  assert.equal(buildDailyRunId('2026-07-26'), `${TELEMETRY_SYSTEM}:2026-07-26`);
  assert.equal(buildDailyRunId('2026-07-26', 'genie_youtube'), 'genie_youtube:2026-07-26');
  assert.equal(buildDailyRunId('2026-07-26', 'genie_linkedin'), 'genie_linkedin:2026-07-26');
});

test('validateDailyStatus: youtube and linkedin systems pass', () => {
  const youtube = {
    ...loadFixture('status-all-ok.json'),
    system: 'genie_youtube',
    run_id: 'genie_youtube:2026-07-26',
    link: 'genie_youtube:2026-07-26'
  };
  const linkedin = {
    ...loadFixture('status-all-ok.json'),
    system: 'genie_linkedin',
    run_id: 'genie_linkedin:2026-07-26',
    link: 'genie_linkedin:2026-07-26'
  };
  assert.doesNotThrow(() => validateRssDailyStatus(youtube));
  assert.doesNotThrow(() => validateRssDailyStatus(linkedin));
});

test('buildRssDailyStatusBlocks: youtube header uses YouTube Daily Status', () => {
  const status = {
    ...loadFixture('status-empty-failures.json'),
    system: 'genie_youtube',
    run_id: 'genie_youtube:2026-07-26',
    link: 'genie_youtube:2026-07-26'
  };
  const payload = buildRssDailyStatusBlocks(status);
  assert.equal(payload.blocks[0].text.text, 'YouTube Daily Status, 2026-07-26');
});

test('buildRssDailyStatusBlocks: mixed fixture matches expected blocks', () => {
  const status = loadFixture('status-mixed.json');
  const expected = loadFixture('block-kit-mixed.expected.json');
  assert.deepEqual(buildRssDailyStatusBlocks(status), expected);
});

test('buildRssDailyStatusBlocks: empty failures render None', () => {
  const status = loadFixture('status-empty-failures.json');
  const payload = buildRssDailyStatusBlocks(status);
  const failuresBlock = payload.blocks.find(
    (block) => block.type === 'section' && block.text?.text?.startsWith('*Failures:*')
  );
  assert.equal(failuresBlock.text.text, '*Failures:*\n_None_');
});

test('formatItemsSummary: describes volume or empty day', () => {
  assert.equal(
    formatItemsSummary({ fetched: 0, selected: 0, ingested: 0, failed: 0 }),
    'No items fetched or ingested this day.'
  );
  assert.equal(
    formatItemsSummary({ fetched: 200, selected: 80, ingested: 72, failed: 8 }),
    'Ingested 72 of 80 selected items (200 fetched, 8 item failures).'
  );
});

test('buildRssDailyStatusBlocks: long code truncated in Slack, full in JSON', () => {
  const status = loadFixture('status-long-code.json');
  validateRssDailyStatus(status);

  const fullCode = status.failures[0].code;
  assert.ok(fullCode.length > SLACK_FAILURE_CODE_MAX_LENGTH);

  const payload = buildRssDailyStatusBlocks(status);
  const failuresBlock = payload.blocks.find(
    (block) => block.type === 'section' && block.text?.text?.startsWith('*Failures:*')
  );
  const truncated = truncateFailureCodeForSlack(fullCode);
  assert.equal(truncated.length, SLACK_FAILURE_CODE_MAX_LENGTH);
  assert.ok(truncated.endsWith('…'));
  assert.ok(failuresBlock.text.text.includes(truncated));
  assert.equal(failuresBlock.text.text.includes(fullCode), false);
  assert.equal(status.failures[0].code, fullCode);
});
