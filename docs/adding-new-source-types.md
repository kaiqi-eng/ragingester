# Adding New Source Types (Step-by-Step)

This guide shows how to add a new `source_type` end-to-end, using `rss_feed` as the reference implementation.

## 1) Add the Shared Enum Value

Update shared constants so API and web both recognize the new type.

File: `packages/shared/src/index.js`

Add your new key/value in `SOURCE_TYPES`, for example:

```js
export const SOURCE_TYPES = {
  HTTP_API: 'http_api',
  WEBSITE_URL: 'website_url',
  RSS_FEED: 'rss_feed',
  IDENTIFIER_BASED: 'identifier_based',
  MY_NEW_SOURCE: 'my_new_source'
};
```

## 2) Allow It Through Card Validation

File: `apps/api/src/lib/validation.js`

Add the new enum member to the `source_type` zod enum list in `cardInputSchema`.

If the source needs special field rules (for example required params), add validation logic in `validateCardPayload`.

## 3) Implement the Collector

Create a new collector file in `apps/api/src/collectors/`, for example:

`apps/api/src/collectors/my-new-source.js`

Use the collector shape:

```js
export const myNewSourceCollector = {
  id: 'my_new_source',
  async collect({ source_input, params = {}, context = {} }) {
    return {
      raw: {},
      normalized: {},
      metrics: {},
      card_updates: { params: {} },
      logs: []
    };
  }
};
```

Recommended conventions from `rss_feed`:
- Throw clear errors for missing external keys/config.
- Put human-useful details into `logs`.
- Keep `card_updates.params` for successful cursor/checkpoint updates only.

## 4) Register the Collector

File: `apps/api/src/collectors/index.js`

Import your collector and map it in `collectors`:

```js
[SOURCE_TYPES.MY_NEW_SOURCE]: myNewSourceCollector
```

This is what `run-engine` uses via `resolveCollector(card.source_type)`.

## 5) Handle Scheduler-Specific Behavior (If Needed)

If your source needs scheduler prewarm/setup like RSS:

- Add helper(s) in collector file (similar to `prewarmRssFeed`).
- Wire helper into `apps/api/src/lib/scheduler-tick.js`.
- Gate by `SOURCE_TYPES.<YOUR_TYPE>`.

If not needed, skip this step.

## 6) Handle Run Timeout/Retry Special Cases (If Needed)

File: `apps/api/src/lib/run-engine.js`

If the new source needs custom timeout behavior (as `rss_feed` does for manual startup buffer), add a scoped rule here. Keep it source-specific and trigger-mode-specific.

## 7) Expose It in the UI

Because `CardForm` and `CardFilters` already use `Object.values(SOURCE_TYPES)`, adding the enum value usually makes it appear automatically.

Files to verify:
- `apps/web/src/components/CardForm.jsx`
- `apps/web/src/components/CardFilters.jsx`

If your source needs source-specific inputs, add conditional form fields and map them into `params`.

### `smartcursor_link` params example (misc/login links)

Use `source_type: "smartcursor_link"` with `source_input` set to the target URL, then place SmartCursor options in `params`:

```json
{
  "smartcursor_base_url": "https://your-smartcursor-service.onrender.com",
  "smartcursor_api_key": "your-smartcursor-api-key",
  "goal": "Login and extract the latest updates from the dashboard feed.",
  "max_steps": 20,
  "auth": {
    "login_fields": [
      {
        "name": "username",
        "selector": "#username",
        "value": "demo-user"
      },
      {
        "name": "password",
        "selector": "#password",
        "value": "demo-password",
        "secret": true
      }
    ]
  },
  "extraction_schema": {
    "type": "object",
    "properties": {
      "headline": { "type": "string" },
      "summary": { "type": "string" }
    }
  }
}
```

Notes:
- Prefer `SMARTCURSOR_BASE_URL` and `SMARTCURSOR_API_KEY` in env for production; use params for per-card overrides only.
- Keep credentials in `params.auth.login_fields`; do not put secrets in `source_input`.

## 8) Add/Update Environment Variables

If the source calls external systems:

- Add config entries in `apps/api/src/config.js`.
- Add placeholders in:
  - `apps/api/.env.example`
  - repo root `.env.example` (if used)
  - `render.yaml` for deployment env wiring
  - CI workflow env injection if test/runtime depends on secrets (`.github/workflows/ci.yml`)

## 9) Add Tests

Minimum recommended tests:

1. Collector unit/integration-style test in `apps/api/test/<source>.collector.test.js`
2. Run-path test via `executeRun`/routes (success and failure)
3. Scheduler behavior test if scheduled path has custom behavior
4. Cursor/checkpoint test: ensure state updates happen only on success

Reference tests:
- `apps/api/test/rss-feed.collector.test.js`
- `apps/api/test/scheduling-and-runs.test.js`
- `apps/api/test/scheduler-tick.test.js`

## 10) Verify End-to-End

Run:

```bash
npm run test -w @ragingester/api
npm run build -w @ragingester/web
```

Then smoke test in UI:
- Create card with new source type
- Manual run
- (If scheduled) verify scheduled execution and run history

## 11) Common Pitfalls

- Added enum but forgot collector registration -> `unsupported source_type` error.
- Added collector but forgot validation enum -> card create fails.
- External keys missing in runtime env -> run failures.
- Checkpoint/cursor updated on failed runs -> data loss/skip risk (guard with tests).
- Route collisions when adding new card subroutes (define static routes before `/:id` routes).

