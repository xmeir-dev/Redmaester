# Redmaester

Redmaester turns your X bookmarks into agent knowledge.

This repo currently implements **Phase 1 (standalone)**:
- Sync bookmarks from X (mock client enabled by default for local demo)
- Route each new bookmark to one or more agents
- Distill routed bookmarks into per-agent insight markdown
- Queue low-confidence/no-match bookmarks into triage
- Show Dashboard, Ask, Bookmarks, Triage, and Folders views

Optional Phase 2-style filesystem delivery is also available behind `OPENCLAW_WORKSPACE`.

## Product choices currently baked in

- Auto-sync target interval: every 5 minutes
- Auto-sync behavior: stop on first known tweet
- Empty DB behavior: auto-sync falls through to full sync
- Full sync behavior: paginates up to `FULL_SYNC_MAX_PAGES` with `FULL_SYNC_PAGE_SIZE` per page
- Multi-agent routing: enabled
- Confidence threshold: `0.65`
- Low-confidence behavior: send to triage
- Budget guardrail: monthly cap default `$50`
- File strategy for Phase 2: overwrite same tweet file, keep versions in DB
- Agent source in Phase 1: `redmaester.agents.json` config file

## Tech stack

- Next.js (App Router) + TypeScript
- Prisma + SQLite (local-first for rapid setup)
- Anthropic SDK for routing/distillation calls (optional; fallback router works without API key)

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Initialize database:

```bash
npm run db:init
npm run prisma:seed
```

`prisma:seed` only inserts demo bookmark data when `SEED_DEMO_DATA=true`.

4. Start app:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Important env vars

- `DATABASE_URL`: local sqlite path by default
- `ANTHROPIC_API_KEY`: if set, model router is used
- `ROUTING_MODEL`: model id for routing/distillation
- `CHAT_MODEL`: model id for ask/chat responses (defaults to `ROUTING_MODEL`)
- `CHAT_MODEL_TIMEOUT_MS`: timeout for ask/chat calls
- `CHAT_EVIDENCE_LIMIT`: max bookmarks analyzed per answer after ranking full corpus
- `CHAT_CHUNK_SIZE`: records per synthesis chunk for large answers
- `CHAT_MAX_CHUNKS`: max chunk count for multi-pass synthesis
- If you see timeouts in chat, increase `CHAT_MODEL_TIMEOUT_MS` and/or lower `CHAT_MAX_CHUNKS`
- `MONTHLY_BUDGET_USD`: monthly cost cap (default `50`)
- `USE_MOCK_X`: `true` for local mock bookmarks
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`: OAuth app settings from X
- `X_OAUTH_SCOPES`: defaults to `tweet.read users.read bookmark.read offline.access`
- `X_API_BASE_URL`: defaults to `https://api.x.com`
- `CRON_SECRET`: optional bearer secret for `/api/cron/auto-sync`
- `OPENCLAW_WORKSPACE`: optional path to an Openclaw workspace for knowledge delivery
- `FULL_SYNC_PAGE_SIZE`, `FULL_SYNC_MAX_PAGES`, `FULL_SYNC_MAX_BOOKMARKS`: controls full-sync depth
- Set `FULL_SYNC_MAX_PAGES=0` and/or `FULL_SYNC_MAX_BOOKMARKS=0` for no cap
- Full sync uses a local cursor file (`.redmaester-sync-state.json`) so repeated runs resume where they stopped.

## Connecting real X data

1. Set `USE_MOCK_X=false` in `.env`.
2. Fill in `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`.
3. Start app and open Dashboard.
4. Click **Connect X Account**.
5. After callback completes, run auto/full sync from Dashboard controls.

If sync says account is not connected, run the connect flow again.

## Optional Openclaw delivery

Set `OPENCLAW_WORKSPACE` to your Openclaw root path. Then each routed insight is written to:

- `skills/{skillName}/knowledge/{tweetId}.md`

The first time a skill is targeted, Redmaester appends one managed knowledge block to that skill's `SKILL.md` if it is missing.
When this variable is set, Redmaester also attempts to source agents from `skills/*/SKILL.md` automatically, with fallback to `redmaester.agents.json`.

## Where to configure agents

Edit `redmaester.agents.json`.

Each entry is a routable agent in Phase 1:

```json
{
  "name": "growth-operator",
  "department": "Growth",
  "description": "Finds repeatable growth loops and distribution ideas from market signals.",
  "routingHints": ["growth", "distribution", "acquisition", "conversion"]
}
```

## Current API endpoints

- `POST /api/sync` with `{ "mode": "AUTO" | "FULL" }`
- `POST /api/chat` with `{ "question": "..." }`
- `GET /api/cron/auto-sync` (requires `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set)
- `GET /api/triage`
- `POST /api/triage/resolve`
- `GET /api/auth/x/start`
- `GET /api/auth/x/callback`

## Phase 2 integration hooks already present

- `AgentSource` abstraction in `/src/lib/openclaw/agent-source.ts`
- `KnowledgeDelivery` abstraction in `/src/lib/knowledge/delivery.ts`

Today both run in standalone mode. In Phase 2 they can be swapped with Openclaw-backed implementations.
- For local reliability, use an absolute SQLite path (default is `/tmp/redmaester-dev.db`)

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
