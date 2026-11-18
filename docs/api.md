# Slice-1 API contract

Historical base contract. **`current-increment.md` supersedes shared demo entry, authentication, report/status/review/export endpoints and progress semantics. Shared demo entry now returns 410.**

Equivalent human-readable API contract. All paths are relative to the configured loopback origin. No external API/payment provider is called. Responses use JSON and `Cache-Control: no-store`; errors never include SQL, stack traces, cookies, names or stories.

## Security and shared rules

Host must match the configured loopback origin. Every mutation requires exact `Origin` match and `Content-Type: application/json`, a JSON body and at most 48,000 bytes. CORS is not enabled. Missing/`null`/foreign origins are denied. No state-changing GET. Owner routes require a live HttpOnly, SameSite=Strict, one-hour demo session cookie. Local HTTP cookies are deliberately not production Secure cookies.

Response errors:

```json
{"error":{"code":"VALIDATION","message":"Check slug.","fields":{"slug":"Choose another slug."}}}
```

`fields` is optional. Unexpected errors return 500 with a random correlation ID; server logs contain only event type and that ID. Do not log request/response bodies or status tokens.

| Status | Meaning |
|---|---|
| 400 | Invalid or absent JSON |
| 401 | Demo session missing/expired |
| 403 | Origin/Host denied |
| 404 | Unknown or unauthorized wishlist; indistinguishable to prevent ID-based disclosure |
| 409 | Duplicate slug, stale version, invalid state transition or expired publication |
| 413 / 415 | Body too large / not JSON |
| 422 | Validation/unknown field rejected |
| 429 | Rate-limited; Retry-After: 60 |
| 500 / 503 | Redacted server failure / demo gate disabled |

## POST /api/demo-session

Body `{}`. Explicitly enters the **same fictional local owner**, not signup/login. Anyone using the local app can do this. Limit 12 entries/minute for the computer. Returns 200:

```json
{"mode":"fictional-demo","expiresInSeconds":3600}
```

Sets random 256-bit session cookie; only a SHA-256 token hash is stored. Expired session/rate-limit cleanup is opportunistic, not a production retention scheduler.

## DELETE /api/demo-session

Body `{}`. Deletes the matching session hash, expires the cookie, returns `{"signedOut":true}`. It does not delete persisted wishlists.

## GET /api/owner/wishlists

200: `{"wishlists":[{"id":"uuid","displayNames":"Fictional couple","slug":"fictional-couple","state":"draft"}]}`. Only current-session memberships are returned. Empty result is `[]`. No pagination yet; demo-scale only.

## POST /api/owner/wishlists

At most 10 creation requests/minute per fictional owner. Complete accepted body:

```json
{
  "displayNames":"Tara & Arjun (fictional)",
  "story":"Optional plain text",
  "weddingDate":"2027-02-14",
  "expiresOn":"2027-02-15",
  "slug":"fictional-couple",
  "visibility":"unlisted",
  "goals":[{"title":"Our honeymoon","description":"Optional plain text","target":"300000"}]
}
```

Required: display names (1-100 trimmed characters), slug (3-60 lowercase alphanumeric segments separated by single hyphens), visibility (`public|unlisted|private`), 1-20 goals with title (1-100) and decimal-string target. Story/goal description optional, max 2000/1000 characters. Wedding/expiry calendar dates optional or empty/null, 1900-2200, actual calendar validation. Expiry must not already have passed.

Target string permits digits with optional 1-2 decimal digits, no grouping/sign/exponent/whitespace/leading-zero ambiguity. Amount in paise: 1 to 1,000,000,000. Owner ID, currency, mode, confirmation fields and any other unknown fields are rejected.

Returns 201 with OwnerWishlist below. Created in state `draft`, INR, demo mode and undecided funding. Not contribution idempotency: repeated slug requests get one successful draft and 409 for the rest. Full idempotency-key replay semantics come with contribution creation, not fabricated here.

## GET /api/owner/wishlists/{id}

Returns current owner's complete **OwnerWishlist** projection or 404. Membership checked in the SQL query, regardless of guessed UUID:

```json
{
  "id":"uuid","slug":"fictional-couple","displayNames":"Tara & Arjun (fictional)",
  "story":"Optional plain text","weddingDate":"2027-02-14","expiresAt":null,
  "availability":"draft","currency":"INR","paymentMode":"demo",
  "goals":[{"id":"uuid","title":"Our honeymoon","description":"","targetPaise":30000000,"confirmedPaise":0}],
  "state":"draft","visibility":"unlisted","version":1
}
```

## PATCH /api/owner/wishlists/{id}

Body: `{"state":"published","version":1}`. Only these two keys accepted. Up to 20 requests/minute/owner. Version is a positive integer. Returns updated OwnerWishlist with incremented version. State change and audit append are one transaction. See state table for allowed transitions. A stale tab gets 409; refresh, do not blindly retry. No hard delete, recipient-change, mode-change or target-edit route exists.

## GET /api/public/wishlists/{slug}

No session required. Only public/unlisted in published/paused/closed states. Private/draft/archived/unknown all return 404. `availability` may be `available|paused|closed|expired`. Returns the OwnerWishlist example above **without `id`, `state`, `visibility` or `version`**. Goal IDs are non-secret identifiers and never authorize owner access. No guest names, messages, individual payments, user IDs, cookies or management links are included.

The guest HTML route `/w/{slug}` uses the same server projection. The owner `/owner/{id}` route checks a session/membership before rendering any wishlist data. Share URLs/QR contain only `/w/{slug}`.

## Explicitly absent

There are no contribution, checkout, UPI, webhook, refund, payout, admin, upload, notification, CSV export or real-account endpoints. A client cannot activate these through an undocumented flag.
