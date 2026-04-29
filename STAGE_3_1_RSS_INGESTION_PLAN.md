# Stage 3.1 Plan: `rss_feed` Real Ingestion via Genie-RSS + Bharag

## Summary
Implement `rss_feed` as the first real ingestion type in `ragingester` by:
1. Fetching RSS data from Genie-RSS (`POST /api/rss/fetch`) with API key auth.
2. Enforcing 2-minute prewarm before scheduled RSS runs.
3. Ingesting only new feed items (based on stored `pubDate` cursor).
4. Ensuring a Bharag workspace exists for this ingestion type (`rss-feed`), creating it if missing.
5. Converting each new feed item into the required structured document format, including post timestamp, then ingesting to Bharag (`POST /api/v1/ingest`).

## Implementation Changes
1. Configuration and contracts
   1. Add env config for:
      1. `GENIE_RSS_BASE_URL` (default `https://genie-rss-5i00.onrender.com`)
      2. `GENIE_RSS_API_KEY`
      3. `BHARAG_BASE_URL` (default `https://bharag.duckdns.org`)
      4. `BHARAG_MASTER_API_KEY`
   2. Add optional per-card `params` overrides for these values (env remains default path).
   3. Keep existing public API shape for cards; no new required card fields.

2. RSS collector behavior (`source_type=rss_feed`)
   1. Replace current raw XML fetch with Genie-RSS integration:
      1. Request body: `{ url: source_input, since: <stored_cursor_or_null> }`
      2. Header: `X-API-Key`
      3. Parse discovered/generated response and normalize item list.
   2. Cursor policy:
      1. Use `params.rss_cursor_pub_date` as canonical "previous run" cursor.
      2. Pass cursor as `since` to Genie-RSS.
      3. After run success, advance cursor to max ingested `pubDate`.
   3. Workspace policy:
      1. Workspace identity derived from ingestion type slug (`rss-feed`) and name (`RSS Feed`).
      2. On each run, check Bharag workspaces for slug; create if absent.
      3. Cache resolved workspace ID in `params.rss_workspace_id` for faster repeat runs.
   4. Per-item Bharag ingestion:
      1. Build one document per feed item using exact content template:
         - `TAGs: [RSS]`
         - `Timestamp ran: <run timestamp>`
         - `Previous run: <cursor or none>`
         - `Post timestamp: <item pubDate/isoDate>`
         - `Title: <item title>`
         - `Content: <item content>`
         - `Link: <item link>`
      2. Send to `POST /api/v1/ingest` with `x-api-key`, `X-Workspace-ID`, `source_type=manual`, `content_type=doc`, and metadata (`ingestion_type=rss_feed`, original feed URL, item GUID/pubDate).
   5. Collector return payload should include:
      1. Counts (`fetched`, `ingested`, `skipped`)
      2. Cursor before/after
      3. Workspace id/slug
      4. Failed item details for partial failures

3. Scheduler prewarm flow (2-minute advance)
   1. Add scheduler prewarm stage only for `rss_feed` cards:
      1. If run is due in <=2 minutes and not yet warmed for that `next_run_at`, call Genie-RSS health ping (`/health`) and mark warmed state.
      2. Execute actual ingestion only when `next_run_at <= now`.
   2. Persist warmup marker in card params (for current scheduled run key) so polling is idempotent across ticks.
   3. Clear/rotate warmup marker when `next_run_at` advances after run completion.

4. Run engine/repository touchpoints
   1. Preserve existing retry/timeout framework.
   2. Ensure card param updates from collector (cursor/workspace/warmup markers) are persisted safely with run completion updates.
   3. Keep existing `collection_runs` metadata; append RSS-specific run logs for fetch, workspace resolution, and ingest summary.

## Test Plan
1. Collector unit/integration tests
   1. Calls Genie-RSS with `since` cursor and API key.
   2. Creates Bharag workspace when missing, reuses when existing.
   3. Ingests only new items and advances cursor correctly.
   4. Emits required structured content format per item, including `Post timestamp`.
2. Scheduler tests
   1. Prewarm triggers in T-2m window for `rss_feed`.
   2. Run executes at/after `next_run_at`, not at prewarm time.
   3. Warmup marker prevents duplicate pings within same run cycle.
3. Run lifecycle tests
   1. Partial ingest failures keep run result consistent and logged.
   2. Retry/timeout still function with external API calls.
   3. `next_run_at` recomputation and cursor persistence remain correct after success/failure.

## Assumptions and Defaults
1. Bharag integration uses master key auth (`x-api-key`) for both workspace and ingest operations.
2. Workspace mapping is ingestion-type based: `rss_feed -> slug "rss-feed", name "RSS Feed"`.
3. "Only beyond previous run" is defined by stored `pubDate` cursor (`params.rss_cursor_pub_date`).
4. Secrets come from env by default, with optional per-card overrides.
5. If an item lacks `pubDate`, it is treated as non-cursor-advancing and is ingested only when returned by Genie-RSS for the current query window.
