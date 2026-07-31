# Telemetry Contracts (Daily Status + Pipeline Errors)

**Phase:** 0–4 (contracts, DB rollup, Slack status cards, pipeline-error Slack, multi-system + durable idempotency)  
**Module:** [`apps/api/src/telemetry/`](../apps/api/src/telemetry/)  
**Roadmap:** [logging-telemetry-plan.md](./logging-telemetry-plan.md)

## Systems

| `source_type` | `system` | Workflow (pipeline errors) | Status Slack header |
|---------------|----------|----------------------------|---------------------|
| `rss_feed` | `genie_rss` | `Genie_RSS` | `RSS Daily Status, {date}` |
| `youtube` | `genie_youtube` | `Genie_YouTube` | `YouTube Daily Status, {date}` |
| `linkedin` | `genie_linkedin` | `Genie_LinkedIn` | `LinkedIn Daily Status, {date}` |

`run_id` / `link` / pipeline `Execution ID` = `{system}:{YYYY-MM-DD}` (UTC day).

## Schema: `DailyStatus` (aka `RssDailyStatus`)

```json
{
  "system": "genie_rss | genie_youtube | genie_linkedin",
  "run_id": "{system}:YYYY-MM-DD",
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
  "link": "{system}:YYYY-MM-DD"
}
```

Helpers:

| Export | Role |
|--------|------|
| `classifyRun` | `ok` \| `degraded` \| `failed` from run `status` + item `failedCount` |
| `groupFailures` | Aggregate by `(feed, code)` with earliest `first_seen` |
| `validateDailyStatus` | Throw on invalid shape (`validateRssDailyStatus` alias) |
| `buildDailyRunId(date, system?)` | `{system}:{date}` (default `genie_rss`) |
| `buildDailyStatus` | DB rollup for a UTC day + system/sourceType |
| `buildRssDailyStatus` | RSS-only wrapper |
| `buildDailyStatusBlocks` | Slack Block Kit (truncates `code` to 120 chars for display only) |
| `flushDailyStatus` / `flushAllDailyStatuses` | Build + post (feature-flagged); durable idempotency |
| `flushRssDailyStatus` | RSS-only wrapper |
| `emitPipelineError` | Bays-shaped pipeline-error Slack (`emitRssPipelineError` alias) |
| `getTelemetryMetrics` | In-process counters |

Golden fixtures: [`apps/api/test/fixtures/telemetry/`](../apps/api/test/fixtures/telemetry/).

### Ingest classification

| Bucket | Rule |
|--------|------|
| `failed` | Run `status === 'failed'` |
| `degraded` | Run `status === 'success'` and item `failedCount > 0` |
| `ok` | Run `status === 'success'` and `failedCount === 0` |

`pending` / `running` runs are skipped. Degraded runs count in `ingest.degraded` only — they are **not** listed under `failures`.

## Rollup rules

| Topic | Rule |
|-------|------|
| Window | UTC calendar day `[dateT00:00:00.000Z, nextDayT00:00:00.000Z)` |
| Run timestamp | Prefer `ended_at`; fallback `created_at` |
| Scope | Active cards for the chosen `source_type` (fleet-wide) |
| Ingest unit | Each terminal run in the window counts once |
| `failedCount` | `collected_data.metadata.metrics.failed`; missing → `0` |
| `failures[]` | `status=failed` only; `feed=source_input`; `code=run.error` |
| `last_run` | Max terminal `ended_at` in window; if none, day start ISO |

### Dry-run endpoints

- `GET /telemetry/rss-daily-status?date=YYYY-MM-DD` — RSS only (back-compat)
- `GET /telemetry/daily-status?system=genie_youtube&date=YYYY-MM-DD` — any allowed system (default `genie_rss`)

Omit `date` → yesterday UTC. Invalid `date` / `system` → `400`.

## Slack status card

| Topic | Rule |
|-------|------|
| Gate | `TELEMETRY_DAILY_STATUS_ENABLED` (default `false`) |
| Per-system | `TELEMETRY_STATUS_YOUTUBE_ENABLED` / `TELEMETRY_STATUS_LINKEDIN_ENABLED` (default **on** when unset; RSS always included when master on) |
| Auto day | Yesterday UTC via `flushAllDailyStatuses` after digest flush |
| Transport | Prefer `TELEMETRY_STATUS_SLACK_WEBHOOK_URL`; else `SLACK_BOT_TOKEN` + `TELEMETRY_STATUS_SLACK_CHANNEL_ID` |
| Twin JSON | `console.info('telemetry.daily_status', …)`; bot thread / webhook follow-up with fenced JSON |
| Idempotency | Durable table `telemetry_daily_status_posts` PK `(system, date)` + in-process cache |

### Emit endpoints

- `POST /telemetry/rss-daily-status/emit?date=` — RSS force emit
- `POST /telemetry/daily-status/emit?system=&date=` — any system force emit

Flag off → `503`. Force bypasses already-posted checks (still records durable row on success).

## Pipeline-error Slack

On terminal failures for `rss_feed` \| `youtube` \| `linkedin` when `TELEMETRY_PIPELINE_ERRORS_ENABLED`, `emitPipelineError` posts **directly** (no Bays call):

```text
Bays — Pipeline Failure
Workflow: Genie_RSS | Genie_YouTube | Genie_LinkedIn
Failed Node: <source_input>
Error Class: CONFIG/AUTH | NETWORK/TIMEOUT | ...
Error: <free-text message>
Execution ID: {system}:YYYY-MM-DD
Time: <human-readable UTC timestamp>
Auto-Action: <local guidance for class>
@mention
```

Hook: [`run-engine.js`](../apps/api/src/lib/run-engine.js). Slack delivery failures are logged and never fail the run.

### Manual emit

`POST /telemetry/pipeline-error/emit` JSON body:

```json
{
  "failedNode": "<source_input>",
  "error": "<message>",
  "sourceType": "rss_feed | youtube | linkedin",
  "errorClass": "optional",
  "timestamp": "optional ISO"
}
```

`sourceType` defaults to `rss_feed`. Flag off → `503`. Missing `failedNode`/`error` → `400`.

## Metrics

`GET /telemetry/metrics` (auth’d) returns in-process counters:

```json
{
  "status_posted": 0,
  "status_failed": 0,
  "pipeline_error_posted": 0,
  "pipeline_error_failed": 0
}
```

## Durable table

Migration: [`supabase/migrations/20260731_001_telemetry_daily_status_posts.sql`](../supabase/migrations/20260731_001_telemetry_daily_status_posts.sql)

```sql
telemetry_daily_status_posts (
  system text,
  date date,
  posted_at timestamptz,
  run_id text,
  primary key (system, date)
)
```

## Env / channel targets

| Concern | Env / destination | Notes |
|---------|-------------------|-------|
| Daily status gate | `TELEMETRY_DAILY_STATUS_ENABLED` | Default off |
| YouTube status | `TELEMETRY_STATUS_YOUTUBE_ENABLED` | Default on when unset |
| LinkedIn status | `TELEMETRY_STATUS_LINKEDIN_ENABLED` | Default on when unset |
| Status Slack channel | `TELEMETRY_STATUS_SLACK_CHANNEL_ID` | Twin-facing daily card (bot path) |
| Status Slack webhook | `TELEMETRY_STATUS_SLACK_WEBHOOK_URL` | Preferred transport when set |
| Bot token | `SLACK_BOT_TOKEN` | Reused for status + pipeline-error bot paths |
| Timeout | `ALERTS_SLACK_TIMEOUT_MS` | Shared Slack timeout |
| Pipeline errors gate | `TELEMETRY_PIPELINE_ERRORS_ENABLED` | Default off |
| Pipeline errors channel | `TELEMETRY_PIPELINE_ERRORS_SLACK_CHANNEL_ID` | `#bha-pipeline-errors` (bot path) |
| Pipeline errors webhook | `TELEMETRY_PIPELINE_ERRORS_SLACK_WEBHOOK_URL` | Preferred when set |
| Pipeline errors mention | `TELEMETRY_PIPELINE_ERRORS_MENTION` | Optional footer mention |
| Existing digest | `ALERTS_ENABLED`, `SLACK_*` | Plain-text failure digest; unchanged |

## ADR: `failures[].code` vs pipeline `Error Class`

**Decision:** On the daily status card, `failures[].code` is the free-text failure message (`error.message` / `run.error`). It is **not** the pipeline-error taxonomy.

**Rationale:** Ragingester stores free-text errors today; short taxonomy codes are not native on the status card. Classification into `BILLING/QUOTA` | `NETWORK/TIMEOUT` | `SCHEMA/VALIDATION` | `CONFIG/AUTH` | `UNKNOWN` belongs on the `#bha-pipeline-errors` post (`Error Class`), mapped locally without calling the Bays handler.

**Consequence:** Identical root causes with slightly different message text will not collapse into one status-card `count`. Slack status display truncates long codes to 120 characters; the structured JSON keeps the full message.
