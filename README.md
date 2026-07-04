# Redmaester

**Turn your X bookmark graveyard into structured, agent-ready knowledge.**

Live app: [redmaester.vercel.app](https://redmaester.vercel.app) — try the public [tweet classifier demo](https://redmaester.vercel.app/demo/classify) without signing in.

## What it is

People bookmark far more than they ever read. Redmaester connects to your X (Twitter) account, syncs your bookmarks, and runs them through an AI pipeline that turns raw saved posts into a knowledge base your AI agents can actually use:

1. **Sync** — pulls bookmarks via the X API (OAuth 2.0 PKCE). Incremental auto-sync stops at the first known tweet; a cursor-based full sync backfills older history in chunks. An hourly Vercel cron keeps things fresh.
2. **Enrich** — fetches the content behind linked URLs through a layered fallback chain: direct fetch → Playwright (optionally reusing your local browser session) → Browserbase cloud browsers → an x402 micropayment-gated scraper → Jina Reader. Each layer only fires when the previous one fails a content-quality gate.
3. **Classify** — a cheap model (Haiku) assigns every bookmark to a topic **bucket** and labels it `REFERENCE`, `MICRO_SKILL`, or `IGNORE`. Low-confidence cases go to a triage queue instead of being silently misfiled.
4. **Synthesize** — a stronger model (Sonnet) distills `MICRO_SKILL` bookmarks into tactical micro-skills and maintains one continuously re-synthesized **master skill** document per bucket.
5. **Ask** — a terminal-style chat (in the UI and as a CLI) ranks your entire corpus with keyword/synonym heuristics, then answers questions with Claude using chunked multi-pass synthesis, citing the tweets it used.

All model spend is metered against a monthly USD budget. When the budget runs out, syncing continues and AI work simply stays pending until the next window — nothing breaks.

A mock X client is enabled by default, so you can run the whole thing locally without X API credentials.

## Features

- X bookmark sync with AUTO (incremental) and FULL (cursor backfill) modes, plus hourly cron
- Budget-guarded AI pipeline with per-operation cost tracking in Postgres
- Five-layer content enrichment fallback chain with garbage-content detection
- Topic buckets with an AI onboarding wizard and heuristic curation suggestions (merge / promote)
- One living master-skill document per bucket, refreshed as new bookmarks arrive
- Triage queue for low-confidence classifications
- Corpus-wide ask/chat with source citations, in the UI and via `npm run ask` / `npm run chat`
- Optional delivery of skills as markdown files into an external agent workspace (`OPENCLAW_WORKSPACE`)
- Public no-auth demo page that classifies any pasted tweet

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Prisma 6** + **PostgreSQL** (Supabase in production)
- **Anthropic API** — Haiku for classification, Sonnet for synthesis and chat
- **X API v2** with OAuth 2.0 PKCE
- **Playwright** + **Browserbase** for scraping; **x402** (viem, Base chain) for pay-per-fetch; **Turndown** + **Jina Reader** for HTML→Markdown
- **Tailwind CSS** + **Radix UI**
- **Vercel** (serverless + cron), **Zod**, **tsx** CLI scripts

## Getting started

Prerequisites: Node.js 20+, PostgreSQL (local or remote).

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env
# For local development, prefer keeping DB credentials in a local override:
cp .env.local.example .env.local

# 3. Initialize the database (destructive — resets the configured DB)
npm run db:init
npm run prisma:seed   # inserts demo bookmarks only when SEED_DEMO_DATA=true

# 4. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With `USE_MOCK_X=true` (the default) you can sync mock bookmarks and exercise the full pipeline immediately.

No Postgres handy? If Homebrew `postgresql@16` is installed, Redmaester can manage a project-local instance:

```bash
npm run db:local:setup
npm run db:init
```

Safety notes: `db:init` prefers `.env.local` over `.env` and refuses to reset a remote database unless `ALLOW_REMOTE_DB_INIT=true` is set explicitly.

### Connecting real X data

1. Set `USE_MOCK_X=false` and fill in `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` (from your X developer app).
2. Start the app and click **Connect X Account**.
3. After the OAuth callback completes, run **Initial pull (latest 500)** from the UI.

### Ask from the terminal

```bash
npm run ask -- "What marketing advice is in my bookmarks?"
```

Or interactive chat (start the dev server first):

```bash
npm run chat
npm run chat -- --api=http://localhost:3010/api/chat   # custom API target
```

Inside chat: `/clear` resets conversation memory, `/exit` quits.

## Configuration

All settings are environment variables — see [.env.example](.env.example) for the full annotated list. The ones you'll touch most:

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL connection strings | local Postgres |
| `ANTHROPIC_API_KEY` | Enables AI classification, synthesis, and chat (a keyword-based fallback classifier works without it) | — |
| `MONTHLY_BUDGET_USD` | Monthly model-spend cap | `30` |
| `USE_MOCK_X` | Use the mock X client for local demos | `true` |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` / `X_REDIRECT_URI` | X OAuth app credentials | — |
| `CRON_SECRET` | Bearer secret for `/api/cron/auto-sync` | — |
| `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` | Enables the Browserbase enrichment fallback | — |
| `OPENCLAW_WORKSPACE` | Path to an external agent workspace for skill delivery | — |
| `ENABLE_KEYCHAIN_ACCESS` | Let local Playwright enrichment reuse cookies from your own Chromium browsers (see below) | `false` |

**A privacy note on `ENABLE_KEYCHAIN_ACCESS`:** when enabled (local development only), the Playwright enrichment layer decrypts cookies from your own installed browsers (Arc/Chrome/Brave) via the macOS Keychain so scrapes run with your logged-in session. It never runs in serverless deployments, is off by default, and cookies never leave your machine.

**On agent delivery:** `OPENCLAW_WORKSPACE` points at an agent workspace — a directory of `skills/<name>/SKILL.md` files (the Claude-style agent skills layout). When set, Redmaester writes each routed insight to `skills/{skillName}/knowledge/{tweetId}.md` and appends a managed knowledge block to the target `SKILL.md` on first use.

## Project structure

```
src/
  app/            Next.js App Router pages + API routes
    api/          sync, classify, chat, buckets, triage, auth, cron, settings
    bookmarks/    main table with filters, sync controls, live log, ask chat
    buckets/      bucket management, AI onboarding wizard, curation
    skills/       master skills and micro-skills
    triage/       low-confidence classification review queue
    demo/classify Public no-auth tweet classifier
  lib/
    sync/         X bookmark sync (AUTO / FULL modes)
    enrichment/   layered content-fetch fallback chain
    classification/  budget-guarded pipeline (discover → enrich → classify → synthesize)
    buckets/      bucket service, curation heuristics, onboarding
    chat/         corpus ranking + chunked multi-pass answering
    domain/       config, budget metering, shared queries
    openclaw/     filesystem delivery into an agent workspace
scripts/          CLI tools (ask, chat, db init/local helpers)
prisma/           schema and seed
docs/             research notes and product docs
```

## Docs

- [One-pager](docs/ONEPAGER.md) — product pitch and positioning
- [Competitive landscape](docs/COMPETITIVE-LANDSCAPE.md) — market research notes
- [Technical sync report](docs/TECHNICAL-SYNC-REPORT.md) — deep dive on the sync design
- [X bookmarks API report](docs/x-bookmarks-api-report.md) — API research notes
