# Redmaester — Technical Report: X Bookmark Sync Methods

> For: Engineering & Product team
> Date: March 2026
> Purpose: Architecture decision for how Redmaester should sync X/Twitter bookmarks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Method A: Official X API v2](#method-a-official-x-api-v2)
3. [Method B: Browser Extension (Internal GraphQL)](#method-b-browser-extension-internal-graphql)
4. [Method C: Cookie Copy-Paste (Siftly Approach)](#method-c-cookie-copy-paste-siftly-approach)
5. [Method D: Hybrid (API + Extension)](#method-d-hybrid-api--extension)
6. [Competitor Deep-Dives](#competitor-deep-dives)
7. [Cost Modeling](#cost-modeling)
8. [Recommendation](#recommendation)

---

## Executive Summary

There are three ways to get X bookmarks, and every successful competitor uses a combination. The critical constraint is the **800-bookmark hard cap** on the official API — the only way around it is using Twitter's internal GraphQL endpoint, which requires either a browser extension or manual cookie extraction.

| Method | Bookmark Limit | Cost | Reliability | User Effort | ToS Risk |
|--------|---------------|------|-------------|-------------|----------|
| Official X API v2 | 800 max | $200/mo or pay-per-use | High | Low (OAuth click) | None |
| Browser Extension | Unlimited | $0 | Medium | Low (install extension) | Medium |
| Cookie Copy-Paste | Unlimited | $0 | Low | High (DevTools) | Medium |
| Hybrid (API + Extension) | Unlimited | ~$1/user/mo ongoing | High | Medium initially | Low-Medium |

---

## Method A: Official X API v2

### User Flow

```
1. User clicks "Connect with X" on Redmaester
2. Redirected to x.com OAuth consent screen
3. User clicks "Authorize"
4. Redirected back to Redmaester with auth code
5. Redmaester exchanges code for access + refresh tokens
6. Server-side cron job polls for new bookmarks (e.g., hourly)
7. User sees bookmarks appear automatically
```

### Technical Flow

```
Redmaester Server
    |
    |-- OAuth 2.0 PKCE Flow
    |   |-- Redirect to x.com/i/oauth2/authorize
    |   |-- Scopes: tweet.read, users.read, bookmark.read, offline.access
    |   |-- Receive auth code on callback
    |   |-- POST /2/oauth2/token (exchange code for tokens)
    |   |-- Store access_token (2hr TTL) + refresh_token
    |
    |-- Sync Job (cron, e.g., every hour)
    |   |-- Refresh access_token if expired (POST /2/oauth2/token with refresh_token)
    |   |-- GET /2/users/{id}/bookmarks?max_results=50
    |   |   &tweet.fields=created_at,author_id,attachments,entities,note_tweet
    |   |   &expansions=author_id,attachments.media_keys
    |   |   &user.fields=name,username
    |   |   &media.fields=type,url,preview_image_url
    |   |-- Paginate via meta.next_token (cursor-based)
    |   |-- Differential sync: stop at first known bookmark ID
    |   |-- Store new bookmarks in PostgreSQL via Prisma
    |
    |-- Rate Limit Handling
        |-- 180 requests / 15 min / user
        |-- On 429: preserve cursor, retry after reset window
        |-- On 402 (credits depleted): pause, alert user
```

### Endpoint Details

| Property | Value |
|----------|-------|
| Endpoint | `GET /2/users/{id}/bookmarks` |
| Auth | OAuth 2.0 PKCE (user context) |
| Rate limit | 180 req / 15 min / user |
| Max per page | 100 (recommended: 50-90, pagination breaks near 100 for some accounts) |
| **Hard cap** | **800 most recent bookmarks** |
| Pagination | Cursor-based via `pagination_token` |
| Token TTL | Access: 2 hours. Refresh: long-lived |
| Folder endpoint | Broken — caps at 20 results, no pagination |

### Pros

1. **Fully ToS-compliant** — Official, sanctioned developer platform. No legal risk.
2. **Reliable and stable** — Documented, versioned API. Won't randomly break when Twitter redeploys.
3. **Works without browser** — Server-side sync runs on a cron. Works even when user's computer is off.
4. **Works for mobile-only users** — Users who only use X on their phone still get synced.
5. **Cross-device by default** — One OAuth token covers all bookmarks regardless of which device they were created on.
6. **Clean OAuth UX** — "Connect with X" → one click → done. Users understand this pattern.
7. **App Store / mobile friendly** — Works if you build native mobile apps later.
8. **Structured response format** — Well-documented JSON with tweet fields, user fields, media, expansions.
9. **No maintenance burden** — No rotating query IDs, bearer tokens, or feature flags to track.
10. **Works in any browser** — Safari, Firefox, Arc, Brave. Not Chrome-only.
11. **No permission anxiety** — Users don't grant access to their cookies or browsing data.
12. **B2B / enterprise friendly** — Passes corporate security reviews. No Chrome extension install required on managed devices.
13. **Webhook-ready** — If X ever ships bookmark webhooks, you're positioned to use them.

### Cons

1. **800-bookmark hard limit** — The single biggest problem. Users with 2,000+ bookmarks can never get full history. This is a **data ceiling**, not a rate limit.
2. **Costs money** — Minimum $200/mo (Basic tier) or pay-per-use (~$0.005/post read). That's $2,400/year before you earn a dollar.
3. **Pagination is buggy** — Multiple developers report the endpoint stops returning `next_token` after 2-3 pages (~200-300 bookmarks), even before hitting 800.
4. **Token management complexity** — Access tokens expire every 2 hours. Need server-side refresh logic. If refresh fails, user must re-auth.
5. **OAuth mobile is broken** — Tweetsmash documented: "Twitter OAuth v2 in mobile doesn't work great with the app installed" — native X app intercepts the redirect URL.
6. **No bookmark folders** — Folder endpoint caps at 20 results with no pagination. Essentially broken.
7. **X can change pricing** — They've changed pricing 3+ times since the Elon acquisition. Your costs are at their mercy.
8. **X can revoke your app** — If they decide your app competes with a future Premium feature, access can be revoked.
9. **No real-time sync** — Polling only. No way to know instantly when a user bookmarks something.
10. **Pay-per-use pricing unclear** — Feb 2026 launch introduced per-request costs, but bookmark-specific rates aren't publicly documented yet.
11. **No deleted tweet recovery** — If a tweet is deleted between bookmark creation and sync, it's lost.

---

## Method B: Browser Extension (Internal GraphQL)

### User Flow

```
1. User installs Chrome extension from Chrome Web Store (one click)
2. User is already logged into x.com in their browser
3. User clicks extension icon or "Sync Bookmarks" button
4. Extension automatically reads session cookies from x.com
5. Extension fetches all bookmarks via internal GraphQL API
6. Data is sent to Redmaester's backend
7. Bookmarks appear in Redmaester dashboard
8. (Optional) Extension monitors for new bookmarks in real-time
```

### Technical Flow

```
Chrome Extension
    |
    |-- Auth: Read cookies from x.com
    |   |-- chrome.cookies.get("auth_token") from x.com
    |   |-- chrome.cookies.get("ct0") from x.com
    |   |-- OR intercept headers via chrome.webRequest.onSendHeaders
    |       (captures Authorization, X-Csrf-Token from outgoing x.com requests)
    |
    |-- Fetch Bookmarks: Internal GraphQL endpoint
    |   |-- GET https://x.com/i/api/graphql/{query_id}/Bookmarks
    |   |-- Headers:
    |   |   Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRI... (static public token)
    |   |   X-Csrf-Token: {ct0_value}
    |   |   Cookie: auth_token={auth_token}; ct0={ct0}
    |   |   X-Twitter-Auth-Type: OAuth2Session
    |   |-- Variables: { count: 100, cursor: "..." }
    |   |-- Features: { graphql_timeline_v2_bookmark_timeline: true, ... }
    |   |-- Paginate via TimelineTimelineCursor (Bottom) in response
    |   |-- NO 800-bookmark limit
    |
    |-- Send to Redmaester Backend
    |   |-- POST /api/sync/extension-import
    |   |-- Payload: array of bookmark objects
    |   |-- Auth: user's Redmaester session token
    |
    |-- Real-time monitoring (optional)
    |   |-- chrome.webRequest.onSendHeaders for x.com/i/api/graphql/*/CreateBookmark
    |   |-- OR monkey-patch XMLHttpRequest.prototype.send (inject script)
    |   |-- Detect bookmark create/delete events
    |   |-- Push new bookmarks to Redmaester backend immediately
    |
    |-- Background sync (optional)
        |-- chrome.alarms API for periodic re-sync
        |-- Manifest V3 service worker (30-sec idle timeout, needs alarms workaround)
```

### Internal GraphQL Endpoint Details

| Property | Value |
|----------|-------|
| Endpoint | `https://x.com/i/api/graphql/{query_id}/Bookmarks` |
| Auth | Session cookies (auth_token + ct0) + static bearer token |
| Rate limit | Undocumented, tied to user's web session (~500 req/15 min estimated) |
| Max per page | 100 |
| **Bookmark limit** | **None (unlimited)** |
| Pagination | Cursor-based via TimelineTimelineCursor |
| Query ID rotation | Every 2-4 weeks (requires extension update) |
| Bearer token | Static, public, embedded in Twitter's JS bundles. Can change on deploys. |

### Chrome Extension Permissions Required

| Permission | Why |
|-----------|-----|
| `host_permissions: ["https://*.x.com/*"]` | Access cookies, make requests to x.com endpoints |
| `cookies` | Read auth_token and ct0 session cookies |
| `webRequest` | Intercept auth headers from outgoing x.com requests |
| `storage` | Store sync state, cached data |
| `alarms` | Schedule background sync tasks |
| `declarativeNetRequest` | Set Origin header on GraphQL requests to avoid CORS |
| `scripting` | Inject content scripts into x.com pages |
| `tabs` | Open x.com in background tab for re-auth if needed |

### How Competitors Implement This

**Twillot (open-source, SolidJS)**:
- Intercepts headers via `chrome.webRequest.onSendHeaders` watching for requests to `/Bookmarks` or `/BookmarkFoldersSlice`
- Extracts `Authorization`, `X-Csrf-Token`, `X-Client-Uuid`, `X-Client-Transaction-Id`
- Stores per-user auth: `user:<uid>:token`, `user:<uid>:csrf`
- If no token found, opens `x.com/i/bookmarks?twillot=reauth` in background tab to trigger a GraphQL request, then intercepts headers
- Incremental sync: compares first/last tweet of fetched page against local records
- Sync only triggers when user opens extension (no true background polling for bookmarks)
- Data stored in IndexedDB, query IDs hardcoded (e.g., `UyNF_BgJ5d5MbtuVukyl7A`)

**Dewey (closed-source, largest player)**:
- Extension injects UI into x.com bookmarks page ("Grab Bookmarks" button)
- Autosync runs "every few seconds" in background when extension is active
- Sends captured data to getdewey.co backend for server-side storage
- Claims 99.999% of syncs go through extension, not official API
- 11K weekly active extension users

**Xbase (closed-source, Svelte)**:
- Reads cookies via `chrome.cookies` API
- Uses `alarms` for periodic background sync
- All data stored locally in IndexedDB via Dexie.js (zero server cost)
- AI features likely use server-side API calls to xbase.so backend
- ~767 users

### Pros

1. **Unlimited bookmarks** — No 800 cap. Access every bookmark ever saved.
2. **$0 API cost** — Uses user's own session. No X API subscription needed.
3. **Real-time sync possible** — Intercept bookmark creation/deletion events as they happen.
4. **Bookmark folders work** — Internal GraphQL returns full folder data (unlike broken official API).
5. **Near-zero per-user marginal cost** — User's browser does the work. Enables aggressive pricing.
6. **Richer data** — Internal responses include engagement metrics, full thread data, article content, note tweets.
7. **No token management** — Browser manages session cookies. No refresh token logic needed.
8. **Proven at scale** — Dewey (50K users), Twillot, Tweetsmash all use this successfully.
9. **Isolated rate limits** — Each user's browser is its own client. One user hitting a limit doesn't affect others.
10. **Thread expansion** — Can call TweetDetail endpoint to unroll threads using same session.
11. **Deleted tweet capture** — If intercepting in real-time, can store content before deletion.

### Cons

1. **Chrome-only (primarily)** — No mobile, no Safari, Firefox requires separate build. Arc/Brave work (Chromium-based).
2. **Fragile: query IDs rotate** — Twitter changes internal query IDs every 2-4 weeks. Extension breaks until updated. **Budget 10-15 hours/month maintenance.**
3. **Fragile: bearer token can change** — Static bearer token embedded in Twitter's JS can change on any deploy.
4. **Fragile: feature flags change** — Every GraphQL request requires a `features` JSON blob. Flag changes break requests.
5. **Browser must be open** — No sync when Chrome is closed. Mobile-only users get nothing.
6. **Extra onboarding friction** — Users must install a Chrome extension. Some won't. Some can't (corporate).
7. **ToS violation (gray area)** — Using undocumented internal APIs violates X's ToS. No enforcement against bookmark tools yet, but risk exists.
8. **No mobile support** — Mobile browsers don't support extensions. Most X users are primarily mobile.
9. **Cookie expiry** — Session cookies expire (weeks). Extension silently stops until user logs into x.com again.
10. **Security perception** — `cookies` + `webRequest` permissions for x.com raise red flags. Users and security teams may refuse.
11. **Chrome Web Store risk** — Google can reject/remove the extension for policy violations.
12. **Anti-scraping escalation** — Twitter adding TLS fingerprinting, client verification, IP reputation scoring.
13. **MV3 service worker limits** — Manifest V3 terminates service workers after 30s idle. Background tasks need `alarms` workarounds.
14. **Separate dev skillset** — Chrome extension development is a different pipeline, different debugging, different deployment (Web Store review: 1-7 days).
15. **Multi-browser data loss** — Data captured only from the browser with the extension installed.

---

## Method C: Cookie Copy-Paste (Siftly Approach)

### User Flow

```
1. User opens x.com in their browser
2. Opens Developer Tools (F12 or Cmd+Option+I)
3. Goes to Application tab → Cookies → x.com
4. Finds and copies "auth_token" value
5. Finds and copies "ct0" value
6. Pastes both into Siftly's Settings page
7. Clicks "Sync Bookmarks"
8. Siftly makes GraphQL requests using those cookies
9. Must repeat every few weeks when cookies expire
```

### Technical Flow

```
Siftly Server (localhost)
    |
    |-- User provides cookies via Settings UI
    |   |-- auth_token → stored in SQLite Setting table
    |   |-- ct0 → stored in SQLite Setting table
    |
    |-- Fetch Bookmarks: Same internal GraphQL endpoint
    |   |-- GET https://x.com/i/api/graphql/{query_id}/Bookmarks
    |   |-- Headers:
    |   |   Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRI... (hardcoded static token)
    |   |   X-Csrf-Token: {ct0}
    |   |   Cookie: auth_token={auth_token}; ct0={ct0}
    |   |   User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...
    |   |   Referer: https://x.com/i/bookmarks
    |   |-- Paginate up to 50 pages (5,000 bookmarks max per sync)
    |   |-- 100 bookmarks per page
    |
    |-- Alternative ingestion methods:
    |   |-- JSON file upload (4 formats auto-detected)
    |   |-- Bookmarklet POST to /api/import/bookmarklet (CORS-enabled for x.com)
    |   |-- Likes import via separate GraphQL endpoint (query ID is placeholder)
    |
    |-- Scheduled auto-sync (optional)
    |   |-- setInterval at 1h, 4h, 8h, or 24h
    |   |-- Stops automatically on 401/403 (expired cookies)
    |
    |-- Storage: SQLite via Prisma (better-sqlite3)
        |-- FTS5 full-text search index rebuilt after each enrichment run
```

### Siftly's Additional Ingestion Methods

| Method | How | Audience |
|--------|-----|----------|
| Live Sync (cookies) | User pastes auth_token + ct0 | Technical users comfortable with DevTools |
| JSON File Upload | Upload exported JSON in 4 auto-detected formats | Users who have twitter-web-exporter output |
| Bookmarklet | Run JS in DevTools console, POSTs to localhost | Developers |
| Likes Import | Same cookie approach, different GraphQL endpoint | Users who want likes too |

### Pros

1. **No extension needed** — Works in any browser, no Chrome Web Store involvement.
2. **No API cost** — Same internal GraphQL endpoint, $0.
3. **Unlimited bookmarks** — Same as extension approach, no 800 cap.
4. **Simple to build** — Server-side code, no extension architecture to maintain.
5. **Open-source reference** — Siftly's full implementation is on GitHub for study.
6. **Self-hosted / privacy** — Data stays on user's machine (Siftly runs locally).

### Cons

1. **Terrible UX** — Users must open DevTools, navigate to Cookies tab, find and copy two values. This filters out 95%+ of potential users.
2. **Cookies expire** — Must repeat the process every few weeks. High churn risk.
3. **No real-time sync** — Manual trigger only (or scheduled, but cookies can expire between syncs).
4. **Fragile: same GraphQL issues** — Query IDs rotate, bearer token can change, feature flags change.
5. **Security risk** — Storing session cookies in plaintext in a database. If compromised, attacker has full access to user's X account.
6. **Server-side requests are detectable** — Twitter can detect that requests are coming from a server IP, not a browser. Higher risk of blocks than extension approach.
7. **Developer-only audience** — Not viable for a mainstream product. Only works for technical users.
8. **No auto-detection of new bookmarks** — Must manually trigger sync or rely on scheduled polling.
9. **Hardcoded query IDs break** — Siftly's codebase already has two different bearer tokens, confirming they've changed at least once.

---

## Method D: Hybrid (API + Extension) — Industry Standard

### User Flow

```
INITIAL SETUP:
1. User signs up for Redmaester
2. Clicks "Connect with X" → OAuth flow → authorized
3. Prompted: "Install our Chrome extension for full bookmark history"
4. User installs extension from Chrome Web Store
5. Extension does one-time full import of ALL bookmarks
6. Redmaester now has complete history

ONGOING:
7. Server-side cron syncs new bookmarks via official API (hourly)
8. Extension (if installed) provides real-time sync as bonus
9. If user doesn't install extension, they still get last 800 + ongoing sync
```

### Technical Flow

```
┌─────────────────────────────────────────────────────────┐
│                   USER'S BROWSER                         │
│                                                          │
│  Chrome Extension (optional, one-time + real-time)       │
│  ├── Intercepts auth headers from x.com GraphQL requests │
│  ├── Fetches ALL bookmarks via internal GraphQL          │
│  ├── POST /api/sync/extension-import to Redmaester       │
│  ├── Monitors bookmark create/delete events (real-time)  │
│  └── Falls back to periodic sync via chrome.alarms       │
│                                                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ HTTPS (bookmark data)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 REDMAESTER BACKEND                        │
│                                                          │
│  API Route: /api/sync/extension-import                   │
│  ├── Receives bookmark array from extension              │
│  ├── Deduplicates by tweet ID                            │
│  └── Stores in PostgreSQL via Prisma                     │
│                                                          │
│  Cron Job: /api/cron/auto-sync (hourly)                  │
│  ├── For each user with OAuth token:                     │
│  │   ├── Refresh access_token if needed                  │
│  │   ├── GET /2/users/{id}/bookmarks (official API)      │
│  │   ├── Differential sync (stop at first known ID)      │
│  │   └── Typically 1-3 API calls per user per sync       │
│  └── Handle rate limits, 402 (credits), token expiry     │
│                                                          │
│  Classification Pipeline (runs after sync)               │
│  ├── Enrich → Classify → Extract micro-skills            │
│  ├── Synthesize master skills per bucket                 │
│  └── Queue uncertain items for triage                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Pros

1. **Best of both worlds** — Full history (extension) + reliable ongoing sync (API).
2. **Graceful degradation** — Users without extension still get 800 bookmarks + ongoing sync. Extension is a bonus, not a requirement.
3. **Mostly ToS-compliant** — Ongoing sync uses official API. Extension is user-initiated, one-time import of their own data.
4. **Low ongoing cost** — After initial extension import, API costs are only for incremental sync (~$0.75-$1.50/user/month at pay-per-use rates).
5. **Real-time possible** — Extension provides instant sync when active; API provides background sync when it's not.
6. **Works on mobile** — API-based ongoing sync works regardless of device.
7. **Lower maintenance** — Extension only needs to work for initial import (one-time). If GraphQL changes, it's less critical than if extension were the sole sync method.
8. **Extension is optional** — Product works without it. Extension users just get a better experience.

### Cons

1. **Two systems to build and maintain** — OAuth + API sync AND Chrome extension. Double the engineering surface.
2. **Extension still has all browser-extension cons** — Chrome-only, permissions anxiety, Web Store review, MV3 limits.
3. **Onboarding complexity** — Users need to understand why they should install an extension after already doing OAuth.
4. **API costs still apply** — Pay-per-use or $200/mo for ongoing sync.
5. **Extension breakage is visible** — If query IDs rotate and extension breaks during a user's initial import, they get a bad first experience.
6. **Two auth systems** — OAuth for API, session cookies for extension. Two potential failure points.

---

## Competitor Deep-Dives

### How Each Competitor Syncs Bookmarks

| Competitor | Primary Method | Secondary Method | Full History? | Real-time? | Open Source? |
|-----------|---------------|-----------------|---------------|------------|-------------|
| **Dewey** | Chrome extension (GraphQL intercept) | Official API (fallback) | Yes | Yes (autosync) | No |
| **Tweetsmash** | Chrome extension (GraphQL) + Official API (OAuth) | Webhook + REST API | Yes | Yes | No |
| **Twillot** | Chrome extension (GraphQL header intercept) | None | Yes | Partial (XHR monkey-patch) | Yes (MPL-2.0) |
| **Xbase** | Chrome extension (cookies + GraphQL) | None | Yes | Yes (alarms) | No |
| **Siftly** | Cookie copy-paste + GraphQL | JSON file upload, bookmarklet | Yes | No (scheduled) | Yes (MIT) |

### Dewey — Technical Details

- **Auth**: OAuth for account linking + extension session cookies for data retrieval
- **Sync**: Extension injects "Grab Bookmarks" button. Autosync runs every few seconds in background.
- **Storage**: Server-side (getdewey.co backend). Enables cross-device sync.
- **Scale**: 50K+ total users, 11K weekly active extension users
- **Multi-platform**: X, LinkedIn, Bluesky, TikTok, Reddit, Instagram, Threads, Truth Social — all via extension
- **Key insight**: "In 99.999% of cases, the Chrome extension is used" — official API is purely a fallback
- **Stack**: Chrome MV3 extension + web dashboard (likely Next.js)

### Tweetsmash — Technical Details

- **Auth**: OAuth 2.0 PKCE for server-side API + extension session cookies for full import
- **Sync**: Dual-channel. Extension for initial full import + real-time. API for periodic server-side sync.
- **Storage**: Supabase (PostgreSQL). Cross-device.
- **Scale**: ~200 paying customers, $72.6K revenue in 2024
- **API**: Has a developer API at `api.tweetsmash.com/v1/` with webhook support (HMAC-SHA256 signed)
- **Key insight**: Won 1st place ($10K) in Twitter's Chirp Developer Challenge 2022
- **Stack**: Next.js + Supabase + Vercel (nearly identical to Redmaester's stack)
- **Extension ID**: `fmjgfjanmcbhpmlemahbnfehjoboopce`

### Twillot — Technical Details (from source code)

- **Auth**: `chrome.webRequest.onSendHeaders` intercepts Authorization + X-Csrf-Token from outgoing x.com GraphQL requests. Extracts user ID from `twid` cookie via content script.
- **Re-auth**: If no token found, opens `x.com/i/bookmarks?twillot=reauth` in background tab, polls until headers are captured.
- **Query IDs**: Hardcoded (e.g., Bookmarks: `UyNF_BgJ5d5MbtuVukyl7A`, Folders: `i78YDd0Tza-dV4SYs58kRg`)
- **Pagination**: 100/page, cursor-based. Incremental sync checks first+last tweet of page against local records.
- **Real-time detection**: Monkey-patches `XMLHttpRequest.prototype.send` to detect CreateBookmark/DeleteBookmark POSTs
- **Storage**: IndexedDB with composite keys (`<user_id>_<tweet_id>`). Multi-user support.
- **AI**: Server-side classification at `api.twillot.com/classify` (likely Cloudflare Workers). Paid feature only.
- **Stack**: SolidJS + Vite + Tailwind + pnpm monorepo
- **Sync trigger**: Only when user opens extension options page (no true background sync for bookmarks)

### Xbase — Technical Details

- **Auth**: `chrome.cookies` API reads auth_token + ct0 from x.com. `webRequest` intercepts outgoing headers.
- **Storage**: IndexedDB via Dexie.js. Fully local. Zero server-side storage.
- **Background sync**: `chrome.alarms` API for periodic tasks
- **AI**: Summaries and smart search — likely server-side calls to xbase.so backend (specific model unknown)
- **Stack**: Svelte (compiled, no runtime), Chrome MV3
- **Key insight**: Zero per-user marginal cost enables lifetime pricing ($250). ~767 users.
- **Network rules**: `declarativeNetRequest` sets `Origin: https://x.com` header to avoid CORS

### Siftly — Technical Details (from source code)

- **Auth**: User manually pastes `auth_token` + `ct0` cookies. Stored in SQLite `Setting` table (plaintext).
- **Bearer token**: Hardcoded static token. Two different tokens in codebase (indicating it's changed).
- **Pagination**: 100/page, up to 50 pages (5,000 bookmark cap per sync)
- **AI integration**: Claude (Haiku by default). Detects Claude CLI session from macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`). Also supports OpenAI, Codex CLI.
- **Pipeline**: 4 stages — entity extraction (free, from rawJson) → vision analysis (12 parallel, Claude) → semantic enrichment (5 per batch) → categorization (20 per batch)
- **Storage**: SQLite via Prisma + FTS5 virtual table for search (rebuilt from scratch each run)
- **Visualization**: React Flow (@xyflow/react) with golden-angle spiral layout
- **Stack**: Next.js 16 + TypeScript + Prisma + SQLite + Tailwind v4 + Radix UI
- **Key insight**: Claude CLI keychain detection is clever — zero-config AI for users with Claude Pro subscription

---

## Cost Modeling

### X API Costs

#### Option 1: Pay-Per-Use (Recommended for startups)

| Operation | Cost |
|-----------|------|
| Reading a post | ~$0.005/post |
| Bookmarks (specific) | Itemized in Developer Console (not publicly documented) |
| User profile | ~$0.010/user |

**Per-user ongoing cost (daily differential sync):**
- Average sync: 1-3 API calls × 50 bookmarks = 50-150 post reads
- Cost: $0.25 - $0.75 per sync
- Monthly (daily sync): ~$7.50 - $22.50 per user
- Monthly (hourly sync): much higher — consider adaptive frequency

**Per-user ongoing cost (hourly differential sync, optimized):**
- Most syncs find 0 new bookmarks: 1 API call × 50 reads = $0.25
- Assume 2-3 productive syncs/day: ~$1.50-$2.25/day
- Monthly: ~$45-$67/user (expensive — reduce frequency)

**Recommendation**: Sync every 4-6 hours for most users, with on-demand sync available via extension.

#### Option 2: Basic Tier ($200/month flat)

- Includes 10K posts/month reads
- Good for up to ~200 users with daily sync (50 reads × 200 users = 10K)
- Beyond that, need top-ups or upgrade to Pro

#### Option 3: Extension-Only ($0)

- Initial import: $0 (client-side)
- Ongoing: $0 (if extension handles all sync)
- BUT: requires browser to be open, Chrome-only

### AI Processing Costs (Anthropic)

This is actually the bigger cost center:

| Operation | Model | Est. Cost per Bookmark |
|-----------|-------|----------------------|
| Classification | Claude Haiku | ~$0.001-$0.003 |
| Micro-skill generation | Claude Sonnet | ~$0.01-$0.03 |
| Master skill synthesis | Claude Sonnet | ~$0.05-$0.15 per bucket refresh |
| Chat / Ask | Claude Sonnet | ~$0.02-$0.05 per query |

For 1,000 bookmarks: ~$1-$3 for classification, ~$10-$30 for micro-skill generation.

### Total Cost Per User (Monthly Estimates)

| Component | API-Only | Extension-Only | Hybrid |
|-----------|----------|---------------|--------|
| X API sync | $7-25 | $0 | $2-5 (reduced frequency) |
| AI classification | $1-3 | $1-3 | $1-3 |
| AI skill generation | $5-15 | $5-15 | $5-15 |
| Infrastructure (Vercel, DB) | $1-2 | $1-2 | $1-2 |
| **Total per user/month** | **$14-45** | **$7-20** | **$9-25** |

---

## Recommendation

### Build the Hybrid (Method D)

**Phase 1 (Now):** Keep current official API implementation. Switch to pay-per-use pricing. This is already working and gets you to market.

**Phase 2 (Next):** Build a companion Chrome extension for one-time full history import. This unlocks the "unlimited bookmarks" feature that every competitor has.

**Phase 3 (Later):** Add real-time sync to the extension for users who have it installed. The API continues to handle background sync for everyone else.

### Why Not Extension-Only?

- Excludes mobile users (majority of X usage)
- Chrome-only is a serious limitation
- Requires ongoing maintenance for GraphQL changes
- Single point of failure if Chrome Web Store pulls the extension

### Why Not API-Only?

- 800-bookmark cap is a dealbreaker for power users
- Your target market (AI power users) likely has 1,000+ bookmarks
- Every competitor offers unlimited bookmark history
- You'd be immediately at a feature disadvantage

### The Hybrid Gives You:

- Full history for power users (extension)
- Background sync for everyone (API)
- Mobile user support (API)
- Graceful degradation (works without extension, better with it)
- Competitive parity with Dewey, Tweetsmash, Twillot
- Lower ongoing API costs (extension reduces polling frequency needed)
