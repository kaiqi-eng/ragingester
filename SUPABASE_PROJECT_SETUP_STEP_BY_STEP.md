# Supabase Setup Guide (Project-Specific): Ragingester

This is a click-by-click setup guide for wiring Supabase to this project.

It covers:

1. Creating/configuring the Supabase project
2. Applying this repo's SQL schema + RLS
3. Setting up Google auth
4. Filling required `.env` files for API + Web
5. Running and verifying locally
6. Locking auth to approved users only

## 0) What you need before starting

- Supabase account
- Google Cloud Console access (for Google OAuth)
- Local repo checked out

Project paths used in this guide:

- `supabase/migrations/20260422_001_init_cards_runs.sql`
- `.env.example`
- `apps/api/.env.example`
- `apps/web/.env.example`

## 1) Create a Supabase project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/projects).
2. Click `New project`.
3. Choose your organization.
4. Enter project name (example: `ragingester-dev`).
5. Set a strong database password.
6. Pick region close to your users.
7. Click `Create new project`.
8. Wait until project provisioning completes.

## 2) Collect your Supabase project values

1. Open your project in Supabase Dashboard.
2. Go to `Project Settings` -> `API`.
3. Copy:
   - `Project URL` (for `SUPABASE_URL` / `VITE_SUPABASE_URL`)
   - `anon`/`publishable` key (for `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`)
   - `service_role`/`secret` key (for `SUPABASE_SERVICE_ROLE_KEY`)
4. Keep this tab open.

## 3) Apply this repo's database schema and RLS

This project expects the schema in:

- `supabase/migrations/20260422_001_init_cards_runs.sql`

Dashboard steps:

1. In Supabase, click `SQL Editor`.
2. Click `New query`.
3. Open `supabase/migrations/20260422_001_init_cards_runs.sql` from this repo.
4. Copy all SQL from that file into the editor.
5. Click `Run`.
6. Confirm these tables exist in `Table Editor`:
   - `public.cards`
   - `public.collection_runs`
   - `public.collected_data`

Notes:

- This migration enables RLS and creates owner-based policies.
- It also creates `set_updated_at()` trigger logic for `cards.updated_at`.

## 4) Configure Google OAuth in Supabase

This web app uses Google sign-in (`Continue with Google`).

### 4A) Configure URLs in Supabase Auth

1. Go to `Authentication` -> `URL Configuration`.
2. Set `Site URL`:
   - local: `http://localhost:5173`
3. Add `Redirect URLs`:
   - `http://localhost:5173`
   - your production frontend URL (when available)
4. Save changes.

### 4B) Enable Google provider

1. Go to `Authentication` -> `Providers`.
2. Open `Google`.
3. Toggle provider to `Enabled`.
4. Leave this page open; you will paste Google OAuth credentials next.

### 4C) Create Google OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a GCP project.
3. Go to `APIs & Services` -> `Credentials`.
4. Click `Create Credentials` -> `OAuth client ID`.
5. App type: `Web application`.
6. Add `Authorized redirect URI` from Supabase Google provider page (copy exactly).
7. Create credential and copy:
   - Client ID
   - Client Secret

### 4D) Finish Google provider setup in Supabase

1. Back in Supabase `Authentication` -> `Providers` -> `Google`.
2. Paste Google Client ID.
3. Paste Google Client Secret.
4. Save.

## 5) Fill local environment files

Use the values from Step 2.

## 5A) Root `.env`

1. Copy `.env.example` to `.env` at repo root.
2. Set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET` (from Supabase JWT settings, if required in your flow)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## 5B) API env (`apps/api/.env`)

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
3. Keep default local values unless needed:
   - `PORT=4000`
   - `CORS_ORIGIN=http://localhost:5173`

## 5C) Web env (`apps/web/.env`)

1. Copy `apps/web/.env.example` to `apps/web/.env`.
2. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_BASE_URL=http://localhost:4000`

## 6) Install and run locally

From repo root:

```powershell
npm.cmd install
npm.cmd run dev:api
```

Open a second terminal (repo root):

```powershell
npm.cmd run dev:web
```

Then open `http://localhost:5173`.

## 7) Verify setup end-to-end

1. Click `Continue with Google` in web app.
2. Complete Google sign-in.
3. Confirm you return to the app at `http://localhost:5173`.
4. Create a card.
5. Run the card manually.
6. Confirm run history appears.
7. In Supabase `Table Editor`, verify rows are created in:
   - `cards`
   - `collection_runs`
   - `collected_data` (if collector returns data)

## 8) Set approved-users-only mode (invite-only)

If you want only approved users:

1. Go to `Authentication` -> `Settings` (or `Configuration`).
2. Turn off `Allow new users to sign up`.
3. Go to `Authentication` -> `Users`.
4. Click `Invite user` and add approved emails.
5. In OTP/magic-link flows, set `shouldCreateUser: false` (if used).

You can also use this companion guide in this repo:

- `SUPABASE_APPROVED_USERS_ONLY_GUIDE.md`

## 9) Troubleshooting

- `Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY` in UI:
  - Check `apps/web/.env` values and restart web dev server.
- API appears to run but data is not in Supabase:
  - Ensure `SUPABASE_URL` + key values are present in `apps/api/.env`.
- Google login fails with redirect mismatch:
  - Confirm Google OAuth `Authorized redirect URI` exactly matches Supabase-provided callback URI.
- 401/permission issues after login:
  - Re-run migration SQL and verify RLS policies were created.

## Quick checklist

- [ ] Supabase project created
- [ ] API URL + keys copied
- [ ] Migration SQL executed successfully
- [ ] Google provider enabled and configured
- [ ] `.env`, `apps/api/.env`, `apps/web/.env` updated
- [ ] API + Web run locally
- [ ] Google sign-in works
- [ ] Card CRUD and run history work
- [ ] Approved-users-only mode enabled (if required)
