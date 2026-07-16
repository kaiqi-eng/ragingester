# LinkedIn / YouTube Intel Lane — Handoff

> **Audience:** Next builder (e.g. Ahad) picking up the external intel / “Third Eye” feed lane for Slack Genie, North Star, and the Engine.  
> **Architecture detail:** See [ingestion-stack.md](./ingestion-stack.md) for full Genie → ragingester → Bharag mechanics.  
> **Last updated:** 2026-07-16

## Why this lane matters

LinkedIn and YouTube ingestion are not side experiments. They are part of the Engine’s external orienting layer (intel / “Third Eye”): Slack Genie and North Star need fresh external signal (RSS, YouTube, LinkedIn) alongside internal logs. This doc is the clean handoff so the next owner does not reverse-engineer prototypes.

## Status at a glance

| Lane | Code in ragingester | Production enablement | What lands in Bharag | Transcripts |
|------|---------------------|----------------------|----------------------|-------------|
| **YouTube** | Done (`youtube` collector) | Staggered card-import CSVs exist | Title + description/snippet + link | **Not wired** |
| **LinkedIn** | Done (`linkedin` collector) | **Ops gap** — no production card-import CSV yet | Title + author + reactions + post text + link | N/A |

**Important correction:** LinkedIn is **not** a separate stranded prototype waiting to be merged. It is already a first-class `source_type` in this repo. The remaining work is inventory, cards, Genie smoke, and scheduling — not greenfield collector wiring.

```text
Card (source_type + schedule)
  → ragingester scheduler / manual run
  → collector (youtube | linkedin)
  → Genie-RSS (fetch)
  → Bharag POST /api/v1/ingest (per item)
  → card params (cursor + workspace_id)
```

---

## Where things live

| Piece | Path |
|-------|------|
| YouTube collector | [`apps/api/src/collectors/youtube.js`](../apps/api/src/collectors/youtube.js) |
| LinkedIn collector | [`apps/api/src/collectors/linkedin.js`](../apps/api/src/collectors/linkedin.js) |
| Collector registry | [`apps/api/src/collectors/index.js`](../apps/api/src/collectors/index.js) |
| Shared types | [`packages/shared/src/index.js`](../packages/shared/src/index.js) (`YOUTUBE`, `LINKEDIN`) |
| Stack docs | [`docs/ingestion-stack.md`](./ingestion-stack.md) |
| Add source types guide | [`docs/adding-new-source-types.md`](./adding-new-source-types.md) |
| YouTube unit + e2e tests | `apps/api/test/youtube.collector.test.js`, `youtube.e2e.test.js` |
| LinkedIn unit tests | `apps/api/test/linkedin.collector.test.js` |
| Upstream Genie-RSS | [kaiqi-eng/Genie-RSS](https://github.com/kaiqi-eng/Genie-RSS) |

**Services:** Ragingester schedules and collects; Genie-RSS scrapes/fetches; Bharag stores and indexes for search/Genie.

---

## YouTube — how it works today

### Behavior

1. Normalize `source_input` to a YouTube Atom feed URL when possible (`UC…`, `/channel/UC…`, or `feeds/videos.xml?channel_id=…`).
2. Call Genie `POST /api/rss/fetch` with `{ url, since? }` (`since` = cursor).
3. For each new item (`pubDate > youtube_cursor_pub_date`), ingest one Bharag document.
4. Persist `youtube_cursor_pub_date` and `youtube_workspace_id` on the card.

### What is ingested

| Included | Not included |
|----------|--------------|
| Title | Transcripts / captions |
| Description / content snippet from the Atom feed | Full audio |
| Watch link | Comments |
| pubDate / guid (metadata) | Thumbnails as media assets |

Documents are tagged `TAGs: [YOUTUBE]` and land in Bharag workspace **`youtube-feed`** (`project_tags: ["youtube"]`).  
This is **YouTube Atom RSS via Genie**, not the YouTube Data API and not a transcript pipeline.

### Channels / feeds (inventory in repo)

| File | Role |
|------|------|
| [`apps/api/cards-import-youtube-weekly-sunday-staggered.csv`](../apps/api/cards-import-youtube-weekly-sunday-staggered.csv) | **12** production-shaped channels, Sunday stagger `Europe/London`, `schedule_enabled=true` |
| [`apps/api/cards-import-combined-weekly-sunday-staggered-with-job-names.csv`](../apps/api/cards-import-combined-weekly-sunday-staggered-with-job-names.csv) | Larger combined set (YouTube + RSS) with `job_name` params |
| [`youtube-cards-import.csv`](../youtube-cards-import.csv) (repo root) | Broader inventory; many `schedule_enabled=false` |
| [`apps/api/tmp-youtube-sources.csv`](../apps/api/tmp-youtube-sources.csv) | Source inventory; some rows flagged broken |

### Where data lands

- **Bharag** workspace `youtube-feed` / “YouTube Feed”
- Card + run state in **Supabase** (not a Google Sheet)

---

## LinkedIn — how it works today

### Behavior

Registered as `SOURCE_TYPES.LINKEDIN` → same Genie + Bharag pattern as YouTube/RSS.

**Modes** (`params.linkedin_mode`):

| Mode | `source_input` / params | Genie endpoint |
|------|-------------------------|----------------|
| `profile` (default) | Profile or company URL (`/in/…` or `/company/…`) | `POST /api/linkedin/profile-posts` |
| `topic` | `searchQueries` (or comma-split `source_input`) + optional Genie-mirrored params (`contentType`, `maxPosts`, `scrapeComments`, etc.) | `POST /api/linkedin/topic-posts` |

Cursor: `linkedin_cursor_pub_date`. Workspace cache: `linkedin_workspace_id`.

### What is ingested

Title, author, reactions, post text (`content`), link — tagged `TAGs: [LINKEDIN]`.  
Lands in Bharag workspace **`linkedin-feed`** (`project_tags: ["linkedin"]`).

### Ops gap (why it still feels “prototype”)

- Collector, validation, UI hints, and unit tests exist.
- **No** `cards-import-linkedin-*.csv` production inventory in-repo.
- Reliability / rate limits / auth live primarily in **Genie-RSS** LinkedIn endpoints.
- No LinkedIn live e2e (YouTube has mock e2e); Genie API key is optional for LinkedIn (YouTube hard-requires it).
- No scheduler prewarm for LinkedIn (only `rss_feed` prewarms Genie `/health`).

**Bottom line for the next builder:** wiring into ragingester is done. Next work is operational: choose feeds → import/create cards → smoke Genie → verify Bharag.

---

## What needs to happen next

### A. Wire LinkedIn feeds into production use (primary handoff)

Code path exists. Concrete steps:

1. **Define inventory** — 5+ profile/company URLs and/or topic cards that matter for Engine intel.
2. **Add import CSV** — e.g. `apps/api/cards-import-linkedin-weekly-*.csv` (mirror YouTube staggered schedule pattern).
3. **Import or create cards** — `source_type: linkedin`, schedule, optional `params.job_name`.
4. **Smoke Genie** — exercise `profile-posts` / `topic-posts` with production `GENIE_RSS_API_KEY`; note rate limits / auth failures from Genie-RSS.
5. **Verify** — run history `ingested_count`, cursor advance, Bharag `linkedin-feed` docs `status: indexed`.

Optional hardening (not blocking first 5 feeds):

- Require Genie API key for LinkedIn (parity with YouTube).
- Add LinkedIn to scheduler prewarm if cold starts matter.
- Add mock/live e2e similar to YouTube.

### B. YouTube intel hygiene (secondary)

1. Confirm which staggered/production channels are the “Third Eye / Intel” set for Slack Genie / North Star.
2. Add any missing channels via CSV/UI with correct schedule and tags.
3. Treat description-only ingest as the cheap default lane until transcripts are explicitly prioritized.

### C. Transcripts (if / when decided worth it) — approach only, not wired

Nothing to extend in-place today. Suggested design:

1. Keep current YouTube collector for title + description (cheap, already scheduled).
2. Add optional step after ingest (or `params.fetch_transcript: true`): resolve video ID from `item.link`, fetch captions (YouTube Data API / timedtext / a new Genie endpoint if added).
3. Append transcript to Bharag `content`, or ingest a second doc with a distinct tag (e.g. `[YOUTUBE_TRANSCRIPT]`).
4. Start with a small allowlist — quota, missing captions, and long docs → chunking load in Bharag.

---

## Proposed ownership / next concrete step

| Item | Owner | Specific next step |
|------|-------|--------------------|
| LinkedIn production enablement | **TBD — confirm with Ahad** | e.g. “Wire 5 LinkedIn profile/company feeds into ragingester via card-import CSV + verify `linkedin-feed`” |
| YouTube channel set for intel | TBD | e.g. “Confirm / add 1+ channels into the Bharag `youtube-feed` pipeline with correct tags/schedule” |
| Transcripts go/no-go | Product / Engine lead | Explicit decision; not blocking the description-level intel layer |

**Handoff ask:** Sync with Ahad — can he own this lane now, and which exact next step above does he take? Post confirmation back in the originating thread with “current state + next steps” (this doc + that reply).

---

## Quick verification checklist

For any new YouTube or LinkedIn card:

1. Card `active=true`, schedule enabled (or manual run).
2. Env present: `GENIE_RSS_BASE_URL`, `GENIE_RSS_API_KEY`, `BHARAG_BASE_URL`, `BHARAG_MASTER_API_KEY`.
3. Run history shows ingest counts; cursor param advanced.
4. Bharag workspace (`youtube-feed` or `linkedin-feed`) shows documents `indexed`.
5. Search / Genie can retrieve by workspace slug or `project_tags`.

Full runbook: [ingestion-stack.md — Operations](./ingestion-stack.md#operations-runbook).

---

## Files to open first

```
docs/ingestion-stack.md
docs/linkedin-youtube-intel-handoff.md   ← this file
apps/api/src/collectors/youtube.js
apps/api/src/collectors/linkedin.js
apps/api/src/collectors/index.js
apps/api/cards-import-youtube-weekly-sunday-staggered.csv
```
