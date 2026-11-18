# Current increment: PostgreSQL, HTTPS identity and private email delivery preparation

This supersedes checkpoint-1 statements that auth/reports were absent or that a shared fictional account could be entered. The release target remains a hosted responsive wedding app, **not yet production ready**.

## What changed and why

The user selected a no-gateway direct-to-couple direction: guests declare a payment amount after using UPI, rather than the platform collecting money. A plain QR/redirect/reference/screenshot provides no trustworthy receipt event to this application. Without an approved bank/provider integration, receipt confirmation must remain the couple's manual bank-record check.

The runnable local workflow now implements separate accounts and **synthetic** reporting/confirmation, without a hosted identity, payment, mail, AI or analytics API. It does not generate a real payable UPI QR or process money. Demonstration QR payloads start `DEMO-NOT-PAYABLE|`; wishlist-link QR codes still contain only the local guest URL.

## PostgreSQL implementation - 19 November 2026

The backend now actually uses PostgreSQL **18.7** through **pg/@types/pg 8.23.1**, not SQLite or an emulation. Node **26.13.0** reports LTS **Lithium**. Official EDB Windows binaries run independently of Next on `127.0.0.1:55432`; no shared Windows service, Docker daemon or cloud account was used. Archive SHA256 recorded at download: `EAD0BBC27FB678FA24DCF86B738981323042ABD073C744103BF7F3AED23F9A33` (local fingerprint, not an independently published authenticity attestation).

`data\local-postgres.json` contains generated local credentials; `data\postgres-cluster` holds durable database files. Both are ignored. Schema-owner/migration and app roles are separate. Startup rejects privileged app roles. Tested runtime restrictions deny table creation, trigger disabling, migration-history updates and ledger deletion. Administrators/filesystem owners remain trusted; these are not tamper-proof controls against them.

Current SQL is in `migrations\postgres`: atomic advisory-locked migration application, generated maintained-library auth schema, and an additive fix allowing absent optional timestamps. Migrations refuse unrelated or mismatched-environment databases. Old SQLite files/migrations are historical and remain untouched; no production-data conversion is claimed.

Money uses exact integer-paise NUMERIC values with integral/bounds constraints (no PostgreSQL rounding of fractional paise), converted to JS only after safe-integer checks. Domain timestamps are validated, consistently UTC ISO text; auth uses TIMESTAMPTZ. Queries are parameterized. Remote connection configuration enforces certificate verification even when a URL says `sslmode=require`; disabling TLS verification is rejected.

Transactions use PostgreSQL row/advisory locks, not a process-local mutex. Tests exercise eight simultaneous same-key reports, racing confirmations, duplicate references, slug collisions, stale versions and atomic rate buckets. Deferred constraints reject cache/ledger divergence at commit.

Native `pg_dump` uses an exported repeatable-read snapshot. The automated drill restores into a freshly generated local test database and checks counts, marker and ledger/state reconciliation before dropping only that isolated database. A separate test fills auth/accounts/mailbox plus a confirmed gift/event history before exercising this restore. Backups stay private/local; encrypted off-instance/PITR recovery is still a launch requirement. Reset switches to a new marked synthetic database and preserves the previous one.

## Authentication

Better Auth **1.7.21**, MIT, stable version selected from registry versions because `latest` was a beta. Official docs verified:

- https://better-auth.com/docs/installation
- https://better-auth.com/docs/adapters/postgresql (supported direct Pool adapter)
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/concepts/database (programmatic migration API)

The executed `getMigrations(auth.options).compileMigrations()` supplied `migrations/postgres/002_auth.sql` from a real PostgreSQL connection. Real library handlers manage password hashing, verification, sign-in/sign-out, expiry, recovery and session revocation. Telemetry is explicitly disabled. No hand-rolled password protocol or default administrator credentials.

Local rules: fictional `@example.test` registrations only; 12-128 character passwords; verified email required; generic sign-in/recovery UI and enumeration-resistant signup; sessions one hour with library cookie caching disabled. Cookies are HttpOnly/SameSite=Strict, **not Secure on local HTTP**. Signing out/recovery revokes persisted sessions. Per-email and global database-backed application rate buckets complement library limits.

Local verification/recovery use a private `auth_local_outbox` table. **No email is sent.** `npm run auth:mailbox` is a terminal-only credential viewer, never an HTTP endpoint. Links expire under the auth library; new enqueue operations purge outbox rows older than one hour. The launcher generates a persistent secret in ignored `data\local-auth-secret.txt`, never prints it, and passes it server-side. On Windows, POSIX file modes do not substitute for reviewed account/ACL isolation. This local delivery/secrets setup must not be publicly exposed.

`/api/demo-session` POST is retired (410). Old seeded wishlists are not silently transferred to newly registered owners. Application identities in the demo remain marked synthetic; auth identities are separately stored and mapped by immutable ID, not display name. Legacy SQLite accounts have not been silently imported into the new PostgreSQL demo.

### Production identity increment

Implemented separate exact-origin HTTPS configuration, Secure/HttpOnly/SameSite=Strict cookies, real-account identity mapping, mode-aware authentication messages and a fail-closed `start:production` entrypoint. Root runtime connections check environment markers and reject administrator/schema-owner privileges before queries; the auth library's direct Pool access waits for this same check. Local and production modes cannot be combined. Public payment surfaces remain explicitly synthetic; production auth configuration is **not product launch readiness**.

Migration 004 adds an encrypted authentication-email outbox and persistent UTC delivery-attempt budgets. AES-256-GCM protects queued recipients and private credential links using an independent server key and authenticated job metadata. Final payloads are cleared, finalized metadata is pruned after seven days during worker invocations, and processing expires verification/recovery jobs earlier than the auth library's tokens. Inactive workers delay cleanup. This does not encrypt the entire database/library session tables or defend against a compromised application server.

The fixed-endpoint Resend adapter is implemented but **no provider account, verified sender, real key, scheduler or email delivery is configured**. Explicit approval/sender/key gates precede database use in its CLI. Provider signatures/webhooks are not relevant to this outbound email adapter, and no tracking webhook/pixel was added. Official API and 24-hour idempotency documentation:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys

One job per `auth:deliver` invocation, row locks/expiring leases/fencing tokens, immutable encrypted request bodies, persisted idempotency keys, bounded retries/backoff and maximum five attempts handle uncertain acknowledgements/crashes. `accepted` means a provider ID was acknowledged, not inbox delivery. Exhausted uncertain outcomes remain `unknown`. Atomic budgets conservatively count retries too, stopping at 90 attempts/day and 2,700/month. They cannot control other applications/manual account usage or establish the provider's actual billing settings. Approved dedicated free-plan setup and supervised worker invocation at least once per minute remain launch gates.

Actual tests use real PostgreSQL/restricted roles and a **local mocked transport**, including concurrent workers/enqueues, retry after lost acknowledgement with identical provider key/body, worker crash/lease fencing, daily/monthly quota races, expiry, corrupt ciphertext, rejected/rate-limited/unavailable provider responses, malformed success, HTTPS verification and single-use recovery with session revocation. No actual provider delivery is claimed.

## Actual migrated ER additions

```mermaid
erDiagram
  auth_users ||--o{ auth_sessions : authenticates
  auth_users ||--o{ auth_accounts : credentials
  wishlists ||--|| recipient_snapshots : demo_recipient
  wishlists ||--o{ contributions : declarations
  goals ||--o{ contributions : receives
  recipient_snapshots ||--o{ contributions : captured_by
  contributions ||--|{ claim_events : append_only
  users ||--o{ claim_events : reviews
```

PostgreSQL migrations execute atomically. They include library auth tables/indexes, a local mailbox, immutable recipient snapshots/contribution terms and append-only claim-event triggers. Composite foreign keys enforce goal/recipient/wishlist consistency. All money stays integer paise and INR.

Recipient snapshots in this demo contain only a label copied from the fictional couple name, not a UPI address or payment instrument. Real setup, recipient-name confirmation, reauthentication and versioned recipient changes remain unimplemented.

## Report invariants and states

Amount INR 1 to INR 1,00,000; plain decimal strings with at most two places. Currency mismatch/unknown fields rejected. Optional bounded name/message/reference. A report's amount/goal/currency/recipient/guest text cannot later be edited silently.

A random 256-bit key serves as private status capability and idempotency key. Only its SHA-256 hash and a canonical request hash are stored. Same key/same terms returns the same report, even after a later pause/closure; same key/different terms is 409. This is not permission to initiate a new transfer on retry. The browser stores only that key in sessionStorage for tab-scoped refresh/retry, not name/message.

| From | Allowed next | Confirmed delta |
|---|---|---|
| new declaration | reported, or needs_review for duplicate reference | 0 |
| reported | needs_review, rejected, owner_confirmed | +amount only when confirmed |
| needs_review | rejected, owner_confirmed | +amount only when confirmed |
| owner_confirmed | needs_review | -amount (audited reversal, not a refund) |
| rejected | needs_review | 0 |

Review needs a server-verified authenticated owner, expected version and reason. Confirmation additionally requires an explicit acknowledgement flag. The browser checkbox is not the sole enforcement. Stale/repeated state changes fail; no silent balance adjustment or fake refund button.

Confirmed public demo progress is derived by summing immutable claim-event deltas per goal. Pending/rejected/review reports add zero. Individual names, messages, references and amounts never appear in the public projection. Aggregate changes can still reveal/infer an amount when few gifts exist; no absolute anonymity claim.

Demo overfunding is explicitly simulated: actual confirmed totals remain visible and only the visual bar caps at 100%. **Live hard-cap/overfunding policy remains undecided.**

## Current equivalent API contract

All application mutations still require exact Host/Origin, JSON and a bounded request body. Owner responses are no-store; all pages noindex/no-referrer. Auth verification/recovery links are library-managed token-protected GET ceremonies; app state changes remain POST/PATCH. Next incoming-request logging is disabled to reduce verification/recovery URL leakage; reverse-proxy/host logs still need separate production review.

| Endpoint | Contract |
|---|---|
| `/api/auth/*` | Maintained Better Auth routes, server origin/body/rate guards. Local signup restricted to synthetic email addresses; approved HTTPS identity uses queued verification. No remote profile image |
| POST `/api/public/wishlists/{slug}/reports` | `{goalId,recipientSnapshotId,amount,currency:"INR",guestName?,guestMessage?,reference?,token}`; validated 256-bit key; returns own receipt/status; no auth required |
| POST `/api/guest/status` | `{token}`; scoped receipt only or uniform 404 for invalid/expired key; max 7-day status capability |
| GET `/api/owner/wishlists/{id}/reports?status=all&page=1` | Owner-only, 50 rows/page plus separate reported/review/owner-confirmed/rejected totals |
| PATCH `/api/owner/wishlists/{id}/reports/{claimId}` | `{status,version,reason,acknowledged?}`; acknowledgement true required for confirmation |
| GET `/api/owner/wishlists/{id}/reports/export` | Owner-only private CSV, up to 5,000 rows, fail rather than partial output above limit; formula-prefix neutralization plus CSV quoting |
| POST `/api/demo-session` | 410, no access grant |

Receipt fields: `id,status,amountPaise,currency,goalTitle,recipientLabel,tokenExpiresAt,mode:"demo"`. Owner list additionally includes optional private guest fields, duplicate-reference warning, version and created UTC. Unknown fields/invalid amount: 422; unavailable/stale/key-conflict: 409; no auth: 401; cross-owner/nonexistent: 404; origin denied: 403; rate limit: 429 with Retry-After.

Private URLs use `/gift-status#<random-key>`: fragment not sent in the server URL. The page reads it only when requested, removes it from the visible URL and uses POST for lookup. No service worker, analytics or remote QR service. Anyone possessing the key can view that one receipt; it must stay private.

## Current requirements-to-tests delta

| IDs | Scenario | Expected | Level | Actual latest completed run |
|---|---|---|---|---|
| AUTH01 | Registration/duplicate signup/unverified login | Generic signup shape, no sign-in before verification; hash not plaintext | Real library + PostgreSQL integration | PASS |
| AUTH02 | Verified sign-in/sign-out/expiry/forged cookie | Persisted-session checks; immediate revoke; expired/invalid denied | Integration | PASS |
| AUTH03 | Recovery/reused token/old session | One successful reset; replay and old session denied | Integration | PASS |
| AUTH04 | Owner A vs B reads/edits/reports | 404 without disclosure | Real separate-account HTTP E2E | PASS |
| CLAIM01 | Unverified report | Pending grows; confirmed stays zero | Unit/integration/E2E | PASS |
| CLAIM02 | Retry/same key/conflicting terms | One record/effect; conflict not duplicate | Integration + concurrent HTTP E2E | PASS, including simultaneous retries |
| CLAIM03 | Duplicate/forged reference | Review warning only; never verifies | Integration | PASS |
| CLAIM04 | Wrong goal/recipient/currency/amount | Reject server-side/constraints | Integration | PASS |
| CLAIM05 | Confirmation/double-confirm/reversal/rejection | Exact audited delta; no negative/double count | Integration/E2E | PASS |
| CLAIM06 | Scoped/random/expired guest token | Own receipt only, 404 otherwise | Integration/E2E | PASS |
| CLAIM07 | Immutability | Terms/recipient/event overwrite/delete denied | Integration | PASS |
| CLAIM08 | CSV formula injection | Dangerous leading formula/whitespace quoted and neutralized | Unit + real CSV endpoint E2E | PASS |
| UI02 | Mobile/desktop, 320/390/768/1280 owner forms, session loss/offline | No checked horizontal overflow; form preserved; report->review->confirm->status works | Browser E2E | PASS |
| ACK01 | Confirmation without explicit acknowledgement | 422, no state change | Browser HTTP E2E | PASS |

PostgreSQL checkpoint validation: lint/typecheck passed; **82 unit/integration tests in 6 files passed** in the final combined run; optimized build and **6/6 desktop/mobile E2E passed against a restricted PostgreSQL role** after the private-notice/external-driver changes. Native seed and main-database snapshot/restore also passed. A controlled termination/restart of this project's PostgreSQL process preserved the baseline row counts and returned a writable primary. This tests process restart, not high availability, power-loss guarantees or disk-loss recovery. No physical-device UPI test, full WCAG assessment or independent completed-code security assessment is claimed.

Latest identity-increment validation: lint/typecheck and optimized build passed. A combined **101-test/8-file** suite passed before the final three added guard tests; the final focused config/HTTP/email runner passed **29/29**, including those three and HTTPS recovery. Four browser cases passed initially; the other two found an outdated assertion of intentionally changed session-expiry text. After correcting that selector, **2/2 targeted desktop/mobile cases passed**. No unresolved browser failure is hidden as a successful full-suite run.

A fresh `npm audit --omit=dev --audit-level=low` completed with **0 reported production dependency vulnerabilities** for this lockfile. The earlier HTTP 429 is historical; this audit does not cover development dependencies or prove application security.

A read-only security-review agent inspected the auth/email increment and immediate integration, reporting **no vulnerabilities identified in the scoped changes**. This is not a full-product penetration test or a security guarantee. Unverified assumptions: deployed Host/Origin/TLS/no-cache behavior; correctly provisioned production DB marker/role; actual provider idempotency/acknowledgements/live delivery. No tests or deployment were executed by that reviewer.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| - | - | Auth/email increment | - | No vulnerabilities identified in scoped review | - |

Persistent preview was restarted and checked in Chromium: home/owner/seeded guest HTTP 200, anonymous owner API 401, retired shared entry 410, no observed hydration errors or checked mobile horizontal overflow. Desktop home, mobile guest and 320px owner screenshots were inspected. The URL remains `http://127.0.0.1:4317`, accessible only on this computer, not public hosting.

Hosting research found an additional runtime gate: [Netlify](https://docs.netlify.com/build/functions/configuration/?fn-language=js#node-js-version-for-runtime) bases its function runtime on Lambda and documents Node 24 fallback; [AWS](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) currently labels its Node 26 runtime **preview, not for production**, even though this computer's Node 26 language release is LTS. Production-host compatibility must be validated on supported Node 24 before choosing that path. Netlify's default function region is Ohio and region customization is documented as Pro/Enterprise; no free India-only residency is assumed.

## Remaining release blockers / uncovered risks

Local PostgreSQL is implemented; hosted provisioning, separate hosted failure domains and off-instance disaster recovery remain unimplemented. There is no application/runtime SQLite dependency. Working local accounts/reporting do not authorize public deployment.

Live UPI-ID/QR setup, safe QR-image decoding/re-encoding if selected, recipient reauthentication/change history, stale instructions, actual hosted verification/recovery delivery/worker scheduling, legal/privacy review, actual retention/deletion, goal editing/history, moderation/support, stronger CSP/deployed TLS, encrypted off-instance backups/restore, broader load/browser/accessibility/security review and provider-specific hosting approval remain. Live overfunding policy still needs a decision. No money or screenshots are moved/uploaded, no external messages sent.

Self-hosted open-source auth is free software, not free hosting or a security guarantee. Local credential files, cluster files and backups are accessible to trusted filesystem users; library session/verification data follow the library's format (do not assume all tokens are hashed). Keep data, backups and auth secrets out of source control.
