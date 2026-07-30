# Telemetry Contracts (RSS Daily Status)

**Phase:** 0–3 (contracts, DB rollup, Slack status card, pipeline-error Slack)  
**Module:** [`apps/api/src/telemetry/`](../apps/api/src/telemetry/)  
**Roadmap:** [logging-telemetry-plan.md](./logging-telemetry-plan.md)

## Schema: `RssDailyStatus`

```json
{
  "system": "genie_rss",
  "run_id": "genie_rss:YYYY-MM-DD",
  "date": "YYYY-MM-DD",
  "feeds_active": 0,
  "ingest": { "ok": 0, "degraded": 0, "failed": 0 },
  "last_run": "<ISO 8601 timestamp>",
  "failures": [
    {
      "feed": "<source_input URL>",
      "code": "<error.message text>",
      "count": 0,
      "first_seen": "<ISO timestamp or null>"
    }
  ],
  "link": "genie_rss:YYYY-MM-DD"
}
```

Helpers:

| Export | Role |
|--------|------|
| `classifyRun` | `ok` \| `degraded` \| `failed` from run `status` + item `failedCount` |
| `groupFailures` | Aggregate by `(feed, code)` with earliest `first_seen` |
| `validateRssDailyStatus` | Throw on invalid shape |
| `buildDailyRunId` | `genie_rss:${date}` |
| `buildRssDailyStatus` | DB rollup for a UTC day → validated status |
| `buildRssDailyStatusBlocks` | Slack Block Kit (truncates `code` to 120 chars for display only) |
| `flushRssDailyStatus` | Build + post yesterday’s card (feature-flagged) |

Golden fixtures: [`apps/api/test/fixtures/telemetry/`](../apps/api/test/fixtures/telemetry/).

### Ingest classification

| Bucket | Rule |
|--------|------|
| `failed` | Run `status === 'failed'` |
| `degraded` | Run `status === 'success'` and item `failedCount > 0` |
| `ok` | Run `status === 'success'` and `failedCount === 0` |

`pending` / `running` runs are skipped. Degraded runs count in `ingest.degraded` only — they are **not** listed under `failures`.

## Phase 1 rollup rules

| Topic | Rule |
|-------|------|
| Window | UTC calendar day `[dateT00:00:00.000Z, nextDayT00:00:00.000Z)` |
| Run timestamp | Prefer `ended_at`; fallback `created_at` |
| Scope | All active `source_type=rss_feed` cards (fleet-wide) |
| Ingest unit | Each terminal run in the window counts once |
| `failedCount` | `collected_data.metadata.metrics.failed`; missing → `0` |
| `failures[]` | `status=failed` only; `feed=source_input`; `code=run.error` |
| `run_id` / `link` | Both `genie_rss:YYYY-MM-DD` |
| `last_run` | Max terminal `ended_at` in window; if none, day start ISO |
| Persistence | Computed from DB on each request (no daily status table) |

### Dry-run endpoint

`GET /telemetry/rss-daily-status?date=YYYY-MM-DD` (auth required).

- Omit `date` → yesterday UTC.
- Invalid `date` → `400`.
- Response: schema-valid `RssDailyStatus` JSON (no Slack).

Builder: `buildRssDailyStatus({ repository, date })`.

## Phase 2 Slack status card

| Topic | Rule |
|-------|------|
| Gate | `TELEMETRY_DAILY_STATUS_ENABLED` (default `false`) |
| Auto day | Yesterday UTC, from scheduler after digest flush |
| Transport | Prefer `TELEMETRY_STATUS_SLACK_WEBHOOK_URL`; else `SLACK_BOT_TOKEN` + `TELEMETRY_STATUS_SLACK_CHANNEL_ID` |
| Payload | Block Kit from `buildRssDailyStatusBlocks` + fallback text |
| Twin JSON | `console.info('telemetry.rss_daily_status', …)`; bot thread reply with fenced JSON; webhook second POST with fenced JSON |
| Idempotency | In-memory posted-date set (restart may re-post once; durable = Phase 4) |
| Digest | Unchanged — status card is additive |

### Emit endpoint

`POST /telemetry/rss-daily-status/emit?date=YYYY-MM-DD` (auth required).

- Flag off → `503`.
- Forces emit even if date was already posted this process (smoke/testing).
- Success → `{ posted: true, date, status }`.

Do **not** use `SLACK_CHANNEL_ID` for the status card (that may be digest / other). Status channel stays separate from `#bha-pipeline-errors`.

## Env / channel targets

| Concern | Env / destination | Notes |
|---------|-------------------|-------|
| Daily status gate | `TELEMETRY_DAILY_STATUS_ENABLED` | Default off |
| Status Slack channel | `TELEMETRY_STATUS_SLACK_CHANNEL_ID` | Twin-facing daily card (bot path) |
| Status Slack webhook | `TELEMETRY_STATUS_SLACK_WEBHOOK_URL` | Preferred transport when set |
| Bot token | `SLACK_BOT_TOKEN` | Reused for status + pipeline-error bot paths |
| Timeout | `ALERTS_SLACK_TIMEOUT_MS` | Shared Slack timeout |
| Pipeline errors gate | `TELEMETRY_PIPELINE_ERRORS_ENABLED` | Default off |
| Pipeline errors channel | `TELEMETRY_PIPELINE_ERRORS_SLACK_CHANNEL_ID` | `#bha-pipeline-errors` (bot path) |
| Pipeline errors webhook | `TELEMETRY_PIPELINE_ERRORS_SLACK_WEBHOOK_URL` | Preferred when set |
| Pipeline errors mention | `TELEMETRY_PIPELINE_ERRORS_MENTION` | Optional footer mention |
| Existing digest | `ALERTS_ENABLED`, `SLACK_*` | Plain-text failure digest; unchanged |

## Phase 3 pipeline-error Slack (implemented)

On terminal `rss_feed` failures, `emitRssPipelineError` posts **directly** to the pipeline-errors channel (Block Kit), without calling Bays:

```text
Bays — Pipeline Failure
Workflow: Genie_RSS
Failed Node: <source_input URL>
Error Class: CONFIG/AUTH | NETWORK/TIMEOUT | ...
Error: <free-text message>
Execution ID: genie_rss:YYYY-MM-DD
Time: <human-readable UTC timestamp>
Auto-Action: <local guidance for class>
@mention
```

| Line | Source |
|------|--------|
| Workflow | `Genie_RSS` |
| Failed Node | `source_input` |
| Error Class | Local `classifyErrorClass` heuristics |
| Error | `run.error` / `error.message` |
| Execution ID | `genie_rss:YYYY-MM-DD` (UTC day of failure) |

Hook: [`run-engine.js`](../apps/api/src/lib/run-engine.js) after `recordFailureAlert` (alert card now includes `source_input`). Slack delivery failures are logged and never fail the run.

## ADR: `failures[].code` vs pipeline `Error Class`

**Decision:** On the daily status card, `failures[].code` is the free-text failure message (`error.message` / `run.error`). It is **not** the pipeline-error taxonomy.

**Rationale:** Ragingester stores free-text errors today; short taxonomy codes are not native on the status card. Grouping and Slack display can use the message string. Classification into `BILLING/QUOTA` | `NETWORK/TIMEOUT` | `SCHEMA/VALIDATION` | `CONFIG/AUTH` | `UNKNOWN` belongs on the `#bha-pipeline-errors` post (`Error Class`), mapped locally without calling the Bays handler.

**Consequence:** Identical root causes with slightly different message text will not collapse into one status-card `count`. Slack status display truncates long codes to 120 characters; the structured JSON keeps the full message.
