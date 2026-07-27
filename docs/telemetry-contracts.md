# Telemetry Contracts (RSS Daily Status)

**Phase:** 0 (contracts & fixtures)  
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
  "link": "<run id or log pointer>"
}
```

Helpers:

| Export | Role |
|--------|------|
| `classifyRun` | `ok` \| `degraded` \| `failed` from run `status` + item `failedCount` |
| `groupFailures` | Aggregate by `(feed, code)` with earliest `first_seen` |
| `validateRssDailyStatus` | Throw on invalid shape |
| `buildDailyRunId` | `genie_rss:${date}` |
| `buildRssDailyStatusBlocks` | Slack Block Kit (truncates `code` to 120 chars for display only) |

Golden fixtures: [`apps/api/test/fixtures/telemetry/`](../apps/api/test/fixtures/telemetry/).

### Ingest classification

| Bucket | Rule |
|--------|------|
| `failed` | Run `status === 'failed'` |
| `degraded` | Run `status === 'success'` and item `failedCount > 0` |
| `ok` | Run `status === 'success'` and `failedCount === 0` |

## Env / channel targets (not wired in Phase 0)

| Concern | Env / destination | Notes |
|---------|-------------------|-------|
| Daily status gate | `TELEMETRY_DAILY_STATUS_ENABLED` | Phase 2 |
| Status Slack channel | `TELEMETRY_STATUS_SLACK_CHANNEL_ID` | Twin-facing daily card |
| Status Slack webhook | `TELEMETRY_STATUS_SLACK_WEBHOOK_URL` | Alternate transport |
| Pipeline errors | `#bha-pipeline-errors` via Bays Error Handler | Phase 3; do not invent a second template |
| Existing digest (interim) | `ALERTS_ENABLED`, `SLACK_*` | Plain-text failure digest today |

Status channel and `#bha-pipeline-errors` stay separate: rollup card vs classified failures.

## Bays Error Handler mapping (Phase 3)

| Bays field | Value |
|------------|-------|
| `workflow_name` | `Genie_RSS` (`BAYS_WORKFLOW_NAME`) |
| `failed_node` | Feed URL (`source_input`) |
| `error_class` | Bays taxonomy only |
| `error_message` | Free-text from ragingester |
| `execution_id` | Prefer daily `run_id`; else per-run UUID |

## ADR: `failures[].code` vs Bays `error_class`

**Decision:** On the daily status card, `failures[].code` is the free-text failure message (`error.message` / `run.error`). It is **not** the Bays 5-class taxonomy.

**Rationale:** Ragingester stores free-text errors today; short taxonomy codes are not native. Grouping and Slack display can use the message string. Classification into `billing_quota` | `network_timeout` | `schema_validation` | `config_auth` | `unknown` belongs only on the Bays pipeline-error path (`error_class`), not on the daily status schema.

**Consequence:** Identical root causes with slightly different message text will not collapse into one `count`. Slack display truncates long codes to 120 characters; the structured JSON keeps the full message.
