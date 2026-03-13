# X/Twitter Bookmarks API -- Technical Report for Redmaester

**Date:** March 12, 2026
**Purpose:** Architecture decision support for a bookmark sync product
**Audience:** Engineers building Redmaester

---

## Table of Contents

1. [Official X API v2 Bookmarks Endpoint](#1-official-x-api-v2-bookmarks-endpoint)
2. [X API Pricing Tiers (2026)](#2-x-api-pricing-tiers-2026)
3. [Undocumented/Internal GraphQL API](#3-undocumentedinternal-graphql-api)
4. [Cookie/Session-Based Access](#4-cookiesession-based-access)
5. [Twitter Data Archive Export](#5-twitter-data-archive-export)
6. [Third-Party Libraries and Tools](#6-third-party-libraries-and-tools)
7. [Cost Modeling](#7-cost-modeling)
8. [Terms of Service Considerations](#8-terms-of-service-considerations)
9. [Recent Changes (2025-2026)](#9-recent-changes-2025-2026)
10. [Recommended Approach for Redmaester](#10-recommended-approach-for-redmaester)

---

## 1. Official X API v2 Bookmarks Endpoint

### Endpoint Details

| Property | Value |
|----------|-------|
| **GET (lookup)** | `GET /2/users/{id}/bookmarks` |
| **POST (create)** | `POST /2/users/{id}/bookmarks` |
| **DELETE (remove)** | `DELETE /2/users/{id}/bookmarks/{tweet_id}` |
| **Bookmark Folders** | `GET /2/users/{id}/bookmarks/folders/{folder_id}` |
| **Base URL** | `https://api.x.com` |
| **Max bookmarks returned** | **800 most recent** (hard platform limit) |
| **Max results per page** | 100 (recommended: 50-90; X drops pagination for some accounts near 100) |

### Authentication Requirements

- **Method:** OAuth 2.0 Authorization Code Flow with PKCE (Proof Key for Code Exchange)
- **Required scopes:** `tweet.read`, `users.read`, `bookmark.read` (for lookup), `bookmark.write` (for create/delete)
- **Token lifetime:** Access tokens expire after **2 hours** by default
- **Refresh tokens:** Available if `offline.access` scope is requested; allows silent token renewal without re-prompting the user
- **Flow:** App redirects user to `https://x.com/i/oauth2/authorize` with `code_challenge` (S256), receives `code` on callback, exchanges for tokens at `POST /2/oauth2/token`

### Rate Limits

| Method | Rate Limit | Window |
|--------|-----------|--------|
| GET (lookup) | 180 requests | per 15 minutes, per user |
| POST (create) | 50 requests | per 15 minutes, per user |
| DELETE (remove) | 50 requests | per 15 minutes, per user |

These are **per-user** limits, not per-app. Each authenticated user has their own rate limit budget.

### Pagination

- Cursor-based pagination via `pagination_token` query parameter
- Response includes `meta.next_token` when more results exist
- **Critical limitation:** Pagination stops after approximately 800 bookmarks. The X Engineering team has confirmed this is a hard cap -- you cannot retrieve bookmarks beyond the 800 most recent regardless of pagination.
- Pagination can stop early (after ~3 pages) for some accounts; reported as a known issue on X Developer Community forums.

### Bookmark Folders Limitation

- The folder endpoint (`GET /2/users/{id}/bookmarks/folders/{folder_id}`) returns a **hard-capped 20 results** with no working pagination. This was reported as a bug in late February 2026 and may be addressed in future updates.

### Query Parameters

```
GET /2/users/{id}/bookmarks?max_results=50
  &tweet.fields=created_at,author_id,attachments,entities,note_tweet
  &expansions=author_id,attachments.media_keys
  &user.fields=name,username
  &media.fields=type,url,preview_image_url,alt_text
  &pagination_token={next_token}
```

### Response Format

```json
{
  "data": [
    {
      "id": "1234567890",
      "text": "Tweet content...",
      "author_id": "9876543210",
      "created_at": "2026-03-01T12:00:00.000Z",
      "attachments": { "media_keys": ["..."] },
      "entities": { "urls": [{ "expanded_url": "..." }] }
    }
  ],
  "includes": {
    "users": [
      { "id": "9876543210", "username": "handle", "name": "Display Name" }
    ],
    "media": [
      { "media_key": "...", "type": "photo", "url": "..." }
    ]
  },
  "meta": {
    "result_count": 50,
    "next_token": "cursor_string_for_next_page"
  }
}
```

### What Redmaester Already Implements

Redmaester's `OfficialXClient` (in `src/lib/sync/x-client.ts`) already uses the official API correctly:
- OAuth 2.0 PKCE flow with `bookmark.read` + `offline.access` scopes
- Cursor-based pagination with configurable page size (default 50, capped at 90)
- Handles 429 (rate limit) and 402 (credits depleted) errors with cursor preservation
- Differential sync (auto mode stops at first known bookmark)
- Full sync with resumable cursor stored in the database

---

## 2. X API Pricing Tiers (2026)

### Legacy Fixed Tiers (still available)

| Tier | Monthly Cost | Key Limits | Bookmark Access |
|------|-------------|------------|-----------------|
| **Free** | $0 | 500 posts/mo write, 100 reads/mo, 1 app. Write-only; only `GET /2/users/me` for reads | **No** -- Free tier is essentially write-only |
| **Basic** | $200/mo ($175/mo annual) | 10K posts/mo, 2 app environments, 2 top-ups | **Yes** -- Bookmarks endpoint is accessible |
| **Pro** | $5,000/mo ($4,500/mo annual) | 1M posts/mo, 3 app environments, 2 top-ups | **Yes** |
| **Enterprise** | Custom ($10K-$42K+/mo) | Full firehose, dedicated support | **Yes** |

### NEW: Pay-Per-Use Model (launched February 6, 2026)

X shifted to a consumption-based billing model alongside the legacy tiers:

- **No subscriptions, no monthly caps** (except 2M post reads/mo on pay-per-use)
- Credits purchased upfront in the Developer Console
- Credits deducted per API request
- Auto top-up and spending caps available

#### Known Per-Request Rates

| Operation | Cost |
|-----------|------|
| Reading a post | $0.005 per post |
| User profile data | $0.010 per user |
| Creating a post | $0.010 per request |
| Bookmarks | Itemized pricing (specific rate not publicly documented; available in Developer Console) |
| DM access | Itemized pricing |

#### xAI Credits Incentive

For every dollar spent on X API credits:
- Below $200/billing cycle: no xAI credits
- $200+ cumulative: 10% back in xAI credits
- $500+ cumulative: 15% back
- $1,000+ cumulative: 20% back

---

## 3. Undocumented/Internal GraphQL API

### How Twitter.com Fetches Bookmarks

Twitter.com (x.com) is a React SPA that communicates with its backend via internal GraphQL endpoints. These are **not** the official API -- they are the same endpoints the web client uses.

#### Endpoint Pattern

```
https://x.com/i/api/graphql/{query_id}/{operation_name}
```

#### Known Bookmark-Related GraphQL Operations

| Operation | URL | Method |
|-----------|-----|--------|
| **Bookmarks** (main list) | `https://x.com/i/api/graphql/{qid}/Bookmarks` | GET |
| **BookmarkSearchTimeline** | `https://x.com/i/api/graphql/3jw6DdK3_ZBxvBLnvv3eyw/BookmarkSearchTimeline` | GET |
| **CreateBookmark** | `https://x.com/i/api/graphql/aoDbu3RHznuiSkQ9aNM67Q/CreateBookmark` | POST |
| **bookmarkTweetToFolder** | `https://x.com/i/api/graphql/4KHZvvNbHNf07bsgnL9gWA/bookmarkTweetToFolder` | POST |

**Important:** The `query_id` values (e.g., `3jw6DdK3_ZBxvBLnvv3eyw`) are **rotated every 2-4 weeks** by X to break scrapers. There is no predictable pattern.

#### Key Advantage: No 800-Bookmark Limit

The internal GraphQL API does **not** enforce the 800-bookmark cap that the official API has. Browser extensions using this endpoint can export all bookmarks. Some users report having 200,000+ bookmarks accessible via the web client.

#### Required Headers for GraphQL Requests

```http
Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=...
X-Csrf-Token: {ct0_cookie_value}
Cookie: auth_token={auth_token}; ct0={ct0_value}
Content-Type: application/json
```

The bearer token (`AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=...`) is a **public, static bearer token** embedded in Twitter's JavaScript bundles. It identifies the "Twitter Web App" client rather than a specific user -- user identity comes from the cookies.

#### How Browser Extensions Use This

Extensions like Twitter Web Exporter work by installing a **network interceptor** that captures the GraphQL responses that the Twitter web app naturally generates as the user scrolls. The extension itself does not initiate API calls -- it passively reads data from requests the web app already makes.

This approach:
- Requires the user to be logged in to x.com
- Runs entirely client-side (data never leaves the browser)
- Bypasses the 800-bookmark limit
- Has no API key or developer account requirement

### Anti-Scraping Measures (Timeline of Tightening)

| Date | Change |
|------|--------|
| Nov 2023 | Endpoint changes requiring doc_id (query_id) updates |
| Jan 2024 | Guest token format changes; TLS fingerprinting detection tightened |
| Jan 2024 | Guest account feature removed (killed Nitter) |
| Apr 2024 | doc_id rotation frequency increased; anti-scraping headers added |
| Jul 2024 | Cookie validation requirements changed |
| Oct 2024 | IP reputation scoring tightened |
| Jan 2025 | Guest token binding to browser fingerprints; datacenter IP bans |

### Risks of Using Internal GraphQL API

1. **Instability:** Query IDs rotate every 2-4 weeks, breaking integrations without updates
2. **ToS violation:** Unauthorized automated access violates X's Terms of Service
3. **Account suspension:** X can detect and suspend accounts making automated requests
4. **No SLA:** No documentation, no deprecation notices, no support
5. **Rate limits undocumented:** Internal rate limits exist but are not published; hitting them triggers temporary blocks
6. **Legal risk:** X has sued scrapers (e.g., the lawsuit against data scrapers in 2023-2024)

---

## 4. Cookie/Session-Based Access

### Authentication Components

To make authenticated requests using a user's Twitter session, you need:

| Component | Location | Purpose |
|-----------|----------|---------|
| `auth_token` | Cookie | Session identifier; long-lived (months) |
| `ct0` | Cookie | CSRF token; must match `X-Csrf-Token` header |
| Bearer token | Header | Static app-level token (embedded in Twitter's JS) |

### How to Extract

1. Open browser DevTools on x.com
2. Go to Application/Storage > Cookies > x.com
3. Copy `auth_token` and `ct0` values

Or programmatically via browser extension `document.cookie` access or `chrome.cookies.get()`.

### Making Authenticated Requests

```javascript
const headers = {
  'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  'X-Csrf-Token': ct0Value,
  'Cookie': `auth_token=${authToken}; ct0=${ct0Value}`,
  'Content-Type': 'application/json',
  'X-Twitter-Active-User': 'yes',
  'X-Twitter-Auth-Type': 'OAuth2Session',
  'X-Twitter-Client-Language': 'en'
};

const response = await fetch(
  `https://x.com/i/api/graphql/${queryId}/Bookmarks?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`,
  { headers }
);
```

### Risks and Reliability

- **Session tokens can expire or be invalidated** if X detects anomalous usage patterns
- **IP binding:** X may bind sessions to IP ranges; requests from servers may trigger re-auth
- **Account risk:** Automated use of session cookies can lead to account suspension
- **Maintenance burden:** Bearer tokens, query IDs, and feature flags all change without notice
- **Cannot be used server-side at scale** without proxying through user browsers

---

## 5. Twitter Data Archive Export

### Official Data Archive

Users can request a full data archive via **Settings > Your Account > Download an archive of your data**.

**Critical finding: The official X data archive does NOT include bookmarks.**

The archive contains tweets, DMs, likes, followers/following, ad engagement, and other data -- but bookmarks are excluded.

### Export Format (for what is included)

- Archive delivered as a `.zip` file containing `.js` and `.json` files
- Includes `tweet.js`, `like.js`, `follower.js`, `following.js`, etc.
- No `bookmark.js` or equivalent
- Delivery can take 24-72 hours after request

### Limitations for Bookmark Sync

This approach is **not viable** for bookmark synchronization because bookmarks are simply not included in the export. This is a deliberate omission by X.

---

## 6. Third-Party Libraries and Tools

### Official SDK / Recommended Libraries

#### Python: Tweepy (v4.8.0+)

```python
import tweepy

client = tweepy.Client(bearer_token=BEARER_TOKEN,
                       access_token=ACCESS_TOKEN,
                       access_token_secret=ACCESS_TOKEN_SECRET)

# Get bookmarks
bookmarks = client.get_bookmarks(
    tweet_fields=["created_at", "author_id", "entities"],
    expansions=["author_id"],
    user_fields=["username", "name"],
    max_results=100
)
```

- Supports `get_bookmarks()`, `bookmark()`, `remove_bookmark()`
- Uses official API v2 (subject to 800-bookmark limit)
- Well-maintained, MIT-licensed

#### Node.js: twitter-api-v2 (v1.29.0)

```typescript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: 'xxx',
  appSecret: 'xxx',
  accessToken: 'xxx',
  accessSecret: 'xxx',
});

// Get bookmarks
const bookmarks = await client.v2.bookmarks({
  'tweet.fields': ['created_at', 'author_id'],
  expansions: ['author_id'],
  'user.fields': ['username', 'name'],
  max_results: 100,
});
```

- Strongly typed TypeScript support
- Supports bookmarks CRUD
- Uses official API v2

### Unofficial / GraphQL-Based Libraries

#### Python: twitter-api-client (trevorhobenshield)

- Implements X/Twitter v1, v2, **and GraphQL APIs**
- Cookie-based authentication (uses `ct0` + `auth_token`)
- Can bypass the 800-bookmark limit via GraphQL
- Supports batch operations with higher effective rate limits
- **Risk:** Uses undocumented APIs; accounts may be suspended

#### Python: twitter_openapi_python (fa0311)

- Implementation of Twitter internal API with Pydantic data validation
- Auto-generated type definitions from Twitter's GraphQL schema
- Documents internal endpoints including bookmarks
- Companion project: `TwitterInternalAPIDocument` (documents all internal GraphQL operations)

#### Browser Extensions

| Tool | Approach | 800 Limit | Notes |
|------|----------|-----------|-------|
| **Twitter Web Exporter** (prinsss) | Intercepts web app GraphQL responses | Bypassed | Open source; passive interception; no API calls |
| **X Bookmarks Exporter** | Chrome extension | Bypassed | Exports to CSV, JSON, XLSX |
| **BookmarkSave** | Chrome extension | Bypassed | Exports to PDF, CSV, Markdown |
| **Twillot** | Chrome extension | Bypassed | Full bookmark management |
| **ArchivlyX** | Chrome extension + web app | Bypassed | Search, manage, export |

### Nitter (Defunct)

Nitter was an open-source alternative Twitter frontend. It was **officially discontinued in February 2024** after X removed the guest account feature. Self-hosting is technically possible but requires real X account sessions and is unreliable. Nitter **never supported bookmarks** (bookmarks are private/authenticated-only).

---

## 7. Cost Modeling

### Official API Cost Scenarios

#### Scenario A: Pay-Per-Use (New Model)

Assuming bookmark reads cost approximately the same as post reads ($0.005/post):

| Users | Bookmarks/User | Total Reads | Est. Cost/Sync | Monthly (daily sync) |
|-------|----------------|-------------|----------------|----------------------|
| 10 | 100 | 1,000 | $5.00 | $150.00 |
| 100 | 100 | 10,000 | $50.00 | $1,500.00 |
| 1,000 | 100 | 100,000 | $500.00 | $15,000.00 |
| 10,000 | 100 | 1,000,000 | $5,000.00 | $150,000.00 |

**Note:** These are rough estimates. Actual bookmark read costs should be verified in the Developer Console.

#### Scenario B: Basic Tier ($200/mo)

- Rate limit: 180 GET requests per 15 min per user
- At 50 results/page, can fetch 9,000 bookmarks per 15 min per user
- Shared across all users on the single app
- **Limitation:** The 800-bookmark cap means at most 800 bookmarks per user regardless

#### Scenario C: Optimized Differential Sync

With Redmaester's current auto-sync approach (stop at first known bookmark):
- After initial sync, each subsequent sync likely needs 1-3 API calls per user
- At $0.005/read, ongoing cost per user per sync: ~$0.25-$1.50
- Monthly cost for 100 users (daily sync): ~$750-$4,500

### Cost Optimization Strategies

1. **Differential sync** (already implemented): Only fetch new bookmarks since last sync
2. **Cursor preservation** (already implemented): Resume from where you left off
3. **Adaptive polling frequency**: Sync more frequently for active users, less for inactive
4. **Rate limit awareness** (already implemented): Handle 429 gracefully with cursor preservation
5. **Batch processing**: Consolidate syncs into optimal time windows
6. **Webhook dream**: X does not offer webhooks for bookmarks; no push notification mechanism exists. Polling is the only option.

### Per-User Cost Summary

| Approach | Initial Sync Cost | Ongoing Monthly Cost | 800 Limit |
|----------|-------------------|---------------------|-----------|
| Official API (pay-per-use) | ~$4.00 (800 bookmarks) | ~$0.75-$1.50/user | Yes |
| Official API (Basic tier) | Included in $200 flat | $200 total (shared) | Yes |
| Extension-based (GraphQL) | $0 (client-side) | $0 | No |
| Hybrid (extension + API) | $0 initial, API ongoing | ~$0.75/user ongoing | No for initial |

---

## 8. Terms of Service Considerations

### X Developer Agreement and Policy

Key provisions relevant to Redmaester:

#### Data Storage and Redistribution

- You may distribute only **Post IDs, DM IDs, and/or User IDs** -- not full content
- Limit of **1,500,000 Post IDs** to any entity within any 30-day period (without written permission)
- You may provide up to **500 public Post Objects and/or User Objects** per person per day via non-automated means
- You may share up to **50,000 hydrated public Post/User Objects** per recipient per day; must not be made publicly available

#### Scraping Prohibitions

- X's ToS **explicitly prohibits** unauthorized automated access (scraping)
- Using the internal GraphQL API via automation (not through the web browser) is a ToS violation
- Browser extensions that passively intercept data while the user browses are in a **gray area** -- the user is accessing their own data, but the extension is automating the export

#### AI Training Restriction (2025)

- X prohibits **any use** of X APIs and/or X Content to fine-tune or train a foundation or frontier model, with the exception of Grok
- This affects Redmaester's classification pipeline if it sends bookmark content to AI models for categorization. The policy's scope regarding user-initiated classification of their own bookmarks is ambiguous.

#### Privacy Expectations

- Any use of the X developer platform inconsistent with users' **reasonable expectations of privacy** may result in enforcement
- Bookmarks are explicitly private features -- accessing another user's bookmarks is not possible via the API (only authenticated user's own bookmarks)

#### Enforcement Actions

- Limiting app's API call ability
- Revoking API permissions
- Suspending the app or app owner
- No known specific enforcement actions against bookmark-only tools, but X has:
  - Banned third-party clients (January 2023)
  - Cut off tweet management tools
  - Sued data scrapers

### Risk Assessment by Approach

| Approach | ToS Compliance | Risk Level |
|----------|---------------|------------|
| Official API v2 with OAuth | Fully compliant | Low |
| Browser extension (passive intercept) | Gray area | Medium |
| Server-side cookie/session scraping | Non-compliant | High |
| Unauthorized GraphQL API usage | Non-compliant | High |
| Data archive export | N/A (bookmarks not included) | N/A |

---

## 9. Recent Changes (2025-2026)

### Timeline of Relevant Changes

| Date | Change | Impact |
|------|--------|--------|
| **Oct 2025** | X begins testing pay-per-use API pricing | More flexible cost structure for low-volume apps |
| **Late 2025** | Free tier further restricted; like and follow endpoints removed from Free | Bookmark endpoint confirmed not available on Free |
| **Dec 2025** | X updated Terms of Service | Strengthened anti-scraping language |
| **Dec 2025** | EU fined X EUR120M under DSA | Regulatory pressure increasing |
| **Feb 2026** | Pay-per-use pricing officially launched | Bookmarks gets itemized pricing; no mandatory monthly subscription |
| **Feb 2026** | Bookmark folder endpoint reported buggy (20-result cap, no pagination) | Folder-based sync unreliable |
| **Ongoing** | GraphQL query_id rotation every 2-4 weeks | Undocumented API approaches require constant maintenance |
| **Ongoing** | Anti-scraping measures escalating (fingerprinting, IP scoring) | Cookie-based approaches increasingly fragile |

### Impact on Existing Tools

- Many third-party bookmark tools rely on browser extensions (client-side GraphQL interception), which remain functional but require users to have the extension installed
- Server-side scraping approaches are increasingly difficult due to anti-bot measures
- The new pay-per-use model makes the official API more accessible for small-scale products (no mandatory $200/mo commitment)
- The 800-bookmark cap on the official API remains the primary obstacle for comprehensive bookmark sync

---

## 10. Recommended Approach for Redmaester

### Recommended Architecture: Hybrid (Official API + Browser Extension)

Given Redmaester's goals as a bookmark sync product, the optimal approach combines two complementary strategies:

#### Primary Path: Official API v2 with Pay-Per-Use

**Use for:** Ongoing synchronization of new bookmarks (differential sync)

- **Why:** Fully ToS-compliant, reliable, well-documented, already implemented in Redmaester
- **How:** OAuth 2.0 PKCE flow (already implemented); fetch new bookmarks since last sync
- **Cost:** ~$0.75-$1.50/user/month for daily sync
- **Limitation:** 800 most recent bookmarks only

**Redmaester's current implementation is already well-suited for this.** The `OfficialXClient` handles pagination, rate limits, credits depletion, and differential sync correctly.

#### Supplementary Path: Browser Extension for Initial Import

**Use for:** One-time full history import (bypass 800-bookmark limit)

- **Why:** Only way to access full bookmark history; runs client-side (no server cost); data stays in user's browser
- **How:** Build or integrate a companion Chrome extension that intercepts GraphQL bookmark responses as user scrolls through their bookmarks page on x.com, then sends the data to Redmaester's API
- **Cost:** $0 (client-side only)
- **Risk:** Medium (gray area for ToS, but user is accessing their own data)

#### Architecture Diagram

```
[User's Browser]
    |
    |--- Chrome Extension (initial full import)
    |       |-- Intercepts x.com GraphQL responses
    |       |-- Sends bookmark data to Redmaester API
    |       |-- One-time operation per user
    |
    |--- Redmaester Web App
            |
            |--- OAuth 2.0 PKCE flow --> X API v2
            |       |-- GET /2/users/{id}/bookmarks
            |       |-- Differential sync (auto mode)
            |       |-- Daily/hourly cron
            |
            |--- Prisma/PostgreSQL
                    |-- Bookmark storage
                    |-- Sync cursor state
                    |-- Classification results
```

### Trade-off Summary

| Factor | Official API Only | Extension Only | Hybrid (Recommended) |
|--------|-------------------|----------------|----------------------|
| Full history | No (800 cap) | Yes | Yes |
| Ongoing sync | Yes (automated) | No (manual) | Yes |
| ToS compliance | Full | Gray area | Mostly compliant |
| Server cost | ~$1/user/mo | $0 | ~$1/user/mo ongoing |
| User friction | Low (OAuth) | Medium (install ext) | Medium initially, low ongoing |
| Reliability | High | Medium | High |
| Maintenance | Low | High (query_id rotation) | Medium |

### Specific Recommendations for Redmaester

1. **Keep the current Official API integration as-is.** It is well-implemented and handles edge cases (rate limits, credits, pagination drops) correctly.

2. **Switch from Basic tier to Pay-Per-Use** if not already done. For a startup with <1000 users, pay-per-use will be significantly cheaper than the $200/mo Basic flat fee.

3. **Build a companion Chrome extension** for initial bookmark import. Model it after the Twitter Web Exporter approach: intercept GraphQL responses passively, extract bookmark data, and POST it to Redmaester's ingest API.

4. **Do not attempt server-side cookie/session scraping.** The risks (account suspension, legal liability, maintenance burden) far outweigh the benefits.

5. **Monitor the bookmark folder endpoint.** Once X fixes the 20-result pagination bug, folder-aware sync could be a differentiating feature.

6. **Be cautious with AI classification of bookmark content.** X's 2025 ToS update prohibits using X content to train AI models. User-initiated classification of their own bookmarks for personal organization is likely defensible, but avoid using aggregated bookmark data for model training.

7. **Implement spending caps** in the X Developer Console and in Redmaester's config (`MONTHLY_BUDGET_USD` is already configured at $30 default -- review this based on actual usage).

8. **Consider the `offline.access` scope** for long-lived sessions. Redmaester already requests this scope, which is correct. Implement proactive token refresh before the 2-hour expiry.

---

## Appendix A: Key URLs

- Official API Docs: https://developer.x.com/en/docs/x-api/tweets/bookmarks/introduction
- API Reference: https://docs.x.com/x-api/users/get-bookmarks
- Pricing: https://docs.x.com/x-api/getting-started/pricing
- Developer Policy: https://developer.x.com/en/developer-terms/policy
- Pay-Per-Use Announcement: https://devcommunity.x.com/t/announcing-the-launch-of-x-api-pay-per-use-pricing/256476
- Internal API Documentation (unofficial): https://github.com/fa0311/TwitterInternalAPIDocument
- Twitter API Client (GraphQL): https://github.com/trevorhobenshield/twitter-api-client
- Twitter Web Exporter: https://github.com/prinsss/twitter-web-exporter

## Appendix B: Redmaester's Current Implementation Files

- OAuth flow: `/src/lib/auth/x-auth.ts`
- PKCE utilities: `/src/lib/auth/pkce.ts`
- Token management: `/src/lib/auth/token-store.ts`
- X API client: `/src/lib/sync/x-client.ts`
- Sync orchestration: `/src/lib/sync/sync-service.ts`
- Sync types: `/src/lib/sync/types.ts`
- App configuration: `/src/lib/domain/config.ts`

## Sources

- [Bookmarks Integration Guide -- X Developer Platform](https://developer.x.com/en/docs/x-api/tweets/bookmarks/integrate)
- [Bookmarks Introduction -- X Developer Platform](https://developer.x.com/en/docs/x-api/tweets/bookmarks/introduction)
- [X API Rate Limits](https://docs.x.com/x-api/fundamentals/rate-limits)
- [Get Bookmarks -- X Docs](https://docs.x.com/x-api/users/get-bookmarks)
- [X API Pricing](https://docs.x.com/x-api/getting-started/pricing)
- [Announcing the Launch of X API Pay-Per-Use Pricing](https://devcommunity.x.com/t/announcing-the-launch-of-x-api-pay-per-use-pricing/256476)
- [X Revamps Developer API Pricing, Shifts To Pay-Per-Use Model](https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/)
- [X API Pricing in 2026: Every Tier Explained](https://www.wearefounders.uk/the-x-api-price-hike-a-blow-to-indie-hackers/)
- [Twitter/X API Pricing 2026: All Tiers Compared](https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/)
- [X (Twitter) API Pricing in 2026: Complete Guide](https://getlate.dev/blog/twitter-api-pricing)
- [How to Get X API Key: Complete 2026 Guide](https://elfsight.com/blog/how-to-get-x-twitter-api-key-in-2026/)
- [X is testing a pay-per-use pricing model for its API -- TechCrunch](https://techcrunch.com/2025/10/21/x-is-testing-a-pay-per-use-pricing-model-for-its-api/)
- [Bookmark retrieves only 800 most recent?](https://devcommunity.x.com/t/bookmark-retrieves-only-800-most-recent/169433)
- [How to get more than 800 bookmarks?](https://devcommunity.x.com/t/how-to-get-more-than-800-bookmarks/204704)
- [Bookmarks API v2 stops paginating after ~3 pages](https://devcommunity.x.com/t/bookmarks-api-v2-stops-paginating-after-3-pages-no-next-token-returned/257339)
- [Bookmark folder limits api downloads to 20](https://devcommunity.x.com/t/bookmark-folder-limits-api-downloads-to-20-not-100-and-no-pagination/258508)
- [OAuth 2.0 Authorization Code Flow with PKCE -- X Developer Platform](https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code)
- [Developer Agreement and Policy -- X Developers](https://developer.x.com/en/developer-terms/agreement-and-policy)
- [Developer Policy -- X Developers](https://developer.x.com/en/developer-terms/policy)
- [How to Scrape X.com (Twitter) in 2026](https://scrapfly.io/blog/posts/how-to-scrape-twitter)
- [TwitterInternalAPIDocument -- GitHub](https://github.com/fa0311/TwitterInternalAPIDocument)
- [twitter-api-client -- GitHub](https://github.com/trevorhobenshield/twitter-api-client)
- [Twitter Web Exporter -- GitHub](https://github.com/prinsss/twitter-web-exporter)
- [twitter_openapi_python -- GitHub](https://github.com/fa0311/twitter_openapi_python)
- [Tweepy v4.8.0 Release](https://devcommunity.x.com/t/tweepy-v4-8-0-has-been-released/168815)
- [node-twitter-api-v2 -- npm](https://www.npmjs.com/package/twitter-api-v2)
- [Can I access twitter bookmarks for development purpose for free?](https://devcommunity.x.com/t/can-i-access-twitter-bookmarks-for-development-purpose-for-free/221728)
- [Update to X API Free Tier: Removal of Like and Follow Endpoints](https://devcommunity.x.com/t/update-to-x-api-free-tier-removal-of-like-and-follow-endpoints/247646)
- [Nitter -- GitHub](https://github.com/zedeus/nitter)
- [How to Export Twitter Bookmarks in 2025 -- ArchivlyX](https://www.archivlyx.com/blog/how-to-export-twitter-bookmarks-in-2025-step-by-step-guide)
