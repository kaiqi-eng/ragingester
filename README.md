# Ragingester

Monorepo for a card-based data collection service:

- `apps/web`: React UI for card CRUD, schedules, manual runs, and run history.
- `apps/api`: Node.js/Express API, scheduler worker, collector plugins.
- `packages/shared`: Shared contracts/constants/helpers.
- `supabase/migrations`: SQL schema + RLS policies.

## Quick start

1. Copy `.env.example` into `.env` and app-level env files.
2. Install dependencies: `npm.cmd install`
3. Run API: `npm.cmd run dev:api`
4. Run Web: `npm.cmd run dev:web`
5. Run tests: `npm.cmd test`

## Documentation

- [Ingestion stack](docs/ingestion-stack.md) — all source types: Genie-RSS, YouTube, LinkedIn, SmartCursor, Slack Engine → Bharag.
- [LinkedIn / YouTube intel handoff](docs/linkedin-youtube-intel-handoff.md) — status, architecture summary, and next steps for the Third Eye / external intel lane.
- [Adding new source types](docs/adding-new-source-types.md)

## Stage status

- Stage 0 complete: repo bootstrap + workspace setup.
- Stage 1 complete: auth-aware card CRUD + manual placeholder runs + run history.
- Stage 2 complete: scheduler worker + overlap protection + retry/timeout + next run recomputation.
- Stage 3 baseline complete: collector plugin contract + first production `http_api` + additional source type collectors.