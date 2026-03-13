# Redmaester

Redmaester turns your X bookmarks into structured knowledge buckets, master skills, and micro-skills.

This repo currently implements:
- Sync bookmarks from X (mock client enabled by default for local demo)
- Bucket each bookmark into a primary domain such as `agents`, `growth`, or `ux-ui`
- Classify each bookmark as a `reference`, `micro-skill`, or `ignore`
- Generate one master skill per bucket and optional micro-skills under it
- Queue review cases into triage when needed
- Show Dashboard, Ask, Bookmarks, Buckets, Skills, Logs, and Triage views

Optional Phase 2-style filesystem delivery is also available behind `OPENCLAW_WORKSPACE`.

## Product choices currently baked in

- First manual import pulls the latest `500` bookmarks by default
- Auto-sync runs hourly and scans the latest `500`, stopping at the first known bookmark
- Manual older-history backfill resumes from the saved cursor in `500`-bookmark chunks
- Bookmark classification uses a cheaper model; micro-skill and master-skill generation use Sonnet 4.6
- Every bucket keeps one living master skill and any number of micro-skills
- Budget guardrail: monthly cap default `$30`
- If the monthly budget is exhausted, syncing continues and AI work stays pending until the next budget window
- File strategy for Phase 2: overwrite same tweet file, keep versions in DB

## Tech stack

- Next.js (App Router) + TypeScript
- Prisma + PostgreSQL
- Anthropic SDK for bookmark classification and skill synthesis (optional; fallback classification works without API key)

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

For a safer local reset workflow, create a local override instead:

```bash
cp .env.local.example .env.local
```

3. Initialize database:

```bash
npm run db:init
npm run prisma:seed
```

`prisma:seed` only inserts demo bookmark data when `SEED_DEMO_DATA=true`.
`db:init` is destructive and resets the configured database. The script now prefers `.env.local` over `.env`, so the safest path is to keep local Postgres credentials in `.env.local` and reserve `.env` for non-destructive defaults.

You can also let Redmaester create and manage a project-local Postgres instance if Homebrew `postgresql@16` is installed:

```bash
npm run db:local:setup
npm run db:init
```

## Safe recovery flow

If you need to recover from an empty or reset database without touching a remote Postgres instance:

1. Start a local Postgres database and create a `redmaester_dev` database.
2. Copy `.env.local.example` to `.env.local` and adjust the local credentials if needed, or run `npm run db:local:setup`.
3. Run `npm run db:init`.
4. Start the app, reconnect your X account, and run `Initial pull (latest 500)`.
5. Use `Pull older bookmarks` only if you want to continue historical backfill.

`npm run db:init` now refuses to reset remote databases unless `ALLOW_REMOTE_DB_INIT=true` is set explicitly.

4. Start app:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Important env vars

- `DATABASE_URL`: primary PostgreSQL connection string
- `DIRECT_URL`: direct PostgreSQL connection string for Prisma schema operations
- `ANTHROPIC_API_KEY`: enables model-based bookmark classification and skill synthesis
- `BOOKMARK_CLASSIFICATION_MODEL`: cheap model for bucket assignment and role classification
- `MICRO_SKILL_MODEL`: model for micro-skill generation
- `MASTER_SKILL_MODEL`: model for master-skill synthesis
- `CHAT_MODEL`: model id for ask/chat responses
- `CHAT_MODEL_TIMEOUT_MS`: timeout for ask/chat calls
- `CHAT_EVIDENCE_LIMIT`: max bookmarks analyzed per answer after ranking full corpus
- `CHAT_CHUNK_SIZE`: records per synthesis chunk for large answers
- `CHAT_MAX_CHUNKS`: max chunk count for multi-pass synthesis
- If you see timeouts in chat, increase `CHAT_MODEL_TIMEOUT_MS` and/or lower `CHAT_MAX_CHUNKS`
- `MONTHLY_BUDGET_USD`: monthly cost cap (default `30`)
- `INITIAL_SYNC_DEFAULT_LIMIT`: default size of the first manual import
- `BACKFILL_CHUNK_LIMIT`: manual older-history backfill chunk size
- `AUTO_SYNC_LOOKBACK_LIMIT`: number of recent bookmarks each auto-sync scans
- `USE_MOCK_X`: `true` for local mock bookmarks
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`: OAuth app settings from X
- `X_OAUTH_SCOPES`: defaults to `tweet.read users.read bookmark.read offline.access`
- `X_API_BASE_URL`: defaults to `https://api.x.com`
- `CRON_SECRET`: optional bearer secret for `/api/cron/auto-sync`
- `OPENCLAW_WORKSPACE`: optional path to an Openclaw workspace for knowledge delivery
- `FULL_SYNC_PAGE_SIZE`, `FULL_SYNC_MAX_PAGES`, `FULL_SYNC_MAX_BOOKMARKS`: lower-level X pagination controls
- Set `FULL_SYNC_MAX_PAGES=0` and/or `FULL_SYNC_MAX_BOOKMARKS=0` for no cap
- Full sync saves its backfill cursor in the `Setting.fullSyncCursor` database row so repeated runs resume where they stopped.

## Connecting real X data

1. Set `USE_MOCK_X=false` in `.env`.
2. Fill in `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`.
3. Start app and open Dashboard.
4. Click **Connect X Account**.
5. After callback completes, run **Initial pull (latest 500)** from the UI.

If sync says account is not connected, run the connect flow again.

## Optional Openclaw delivery

Set `OPENCLAW_WORKSPACE` to your Openclaw root path. Then each routed insight is written to:

- `skills/{skillName}/knowledge/{tweetId}.md`

The first time a skill is targeted, Redmaester appends one managed knowledge block to that skill's `SKILL.md` if it is missing.
When this variable is set, Redmaester also attempts to source agents from `skills/*/SKILL.md` automatically, with fallback to `redmaester.agents.json`.

## Current API endpoints

- `POST /api/sync` with `{ "mode": "AUTO" | "FULL" }`
- `POST /api/classify`
- `POST /api/chat` with `{ "question": "..." }`
- `GET /api/cron/auto-sync` (requires `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set)
- `GET /api/triage`
- `POST /api/triage/resolve`
- `POST /api/triage/resolve-skill`
- `GET /api/auth/x/start`
- `GET /api/auth/x/callback`
- `GET /api/bookmarks/count` (advanced and potentially expensive; not used in the default flow)

## Phase 2 integration hooks already present

- `AgentSource` abstraction in `/src/lib/openclaw/agent-source.ts`
- `KnowledgeDelivery` abstraction in `/src/lib/knowledge/delivery.ts`

Today both run in standalone mode. In Phase 2 they can be swapped with Openclaw-backed implementations.
- For local reliability, keep `DATABASE_URL` and `DIRECT_URL` pointed at a local development Postgres database when running `db:init`

## Ask from terminal (Claude Code)

```bash
npm run ask -- "What marketing advice is important in my bookmarks?"
```

## Interactive chat from terminal (Claude Code)

Start Redmaester web app first (`npm run dev -- --port 3010`), then run:

```bash
npm run chat
```

Optional API target:

```bash
npm run chat -- --api=http://localhost:3010/api/chat
```

Commands inside chat:
- `/clear` reset conversation memory
- `/exit` quit
