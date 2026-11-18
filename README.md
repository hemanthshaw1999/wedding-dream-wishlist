# Wedding Dream Wishlist - local demo

**Demo - no real money. Use synthetic data only. This is not a production-ready or publicly deployed product.**

**Current increment:** separate accounts using self-hosted **Better Auth 1.7.21 (MIT)**, verification/recovery through a private local mailbox, persisted wishlists, anonymous synthetic gift reports, private guest status, owner-only manual confirmation/reversal and private CSV export. No hosted identity or payment service is used. **See `docs/current-increment.md` for the current API, test matrix and limitations; checkpoint-1 documents are historical.**

## What actually runs

This project was created using GitHub Copilot CLI on Windows, not the Microsoft 365 Copilot application. No subscription entitlement was inspected or inferred. Java was not on PATH. Docker's executable exists but the checked daemon is unavailable. No cloud account, workplace repository, remote database, paid infrastructure or deployment was used.

The temporary implementation uses Next.js route handlers and SQLite rather than the proposed Spring Boot/PostgreSQL backend. The backend framework decision remains open; the hosted production target is confirmed below. Node's built-in SQLite driver is release-candidate status, so use of it here is a **demo-only deviation**, not a production support guarantee. See `docs/decisions.md`.

**Confirmed direction:** publicly hosted responsive application; PostgreSQL as the hosted datastore; direct-to-couple UPI without a gateway and guest-submitted reports, never automatic bank verification. Current runnable code has **not** been migrated to PostgreSQL or enabled real UPI. No PostgreSQL server tools are available; the checked portable npm package has no stable versions. Hosting costs/audience, live overfunding policy, secure recipient setup, real mail delivery and deployment permission remain separate gates.

The server stores an actual on-disk database. Anonymous browsers can access intentionally published public/unlisted pages **on the same computer**. A loopback link is not a public website. A phone cannot reach its own computer's `127.0.0.1`; do not advertise the local QR as phone-ready.

## Free-service evaluation - 19 November 2026

These are researched candidates, **not configured accounts, integrations or deployments**. Free usage limits can change. Open-source software has no software license charge here; running it still needs compute, storage and operations. No service or software can guarantee zero data leaks.

| Component | Candidate and verified limits | Current status / important limitation |
|---|---|---|
| Login | Self-hosted Better Auth, MIT license | Implemented locally. No hosted identity vendor required; production verification/recovery delivery remains unfinished. |
| PostgreSQL | [Neon Free](https://neon.com/pricing): no card required, 1 GB/project, 100 CU-hours/project, 5 GB public egress/project; compute scales to zero after 5 minutes | Candidate only. App still uses SQLite. Free recovery history is 6 hours with a 1 GB limit, and one manual snapshot; independent backup/restore is still required. |
| Web hosting | [Netlify Free](https://www.netlify.com/pricing/): 300 credits/month; production deploys cost 15 credits, compute 10 credits/GB-hour, bandwidth 20 credits/GB, web requests 2 credits/10k | Candidate only. [Next.js support uses OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/). Our exact app/runtime, private-response caching, quotas and no-spend behavior must be verified before hosting; do not deploy the local SQLite/mailbox configuration. Use a provider subdomain initially, not a purchased domain. |
| Transactional email | [Resend Free](https://resend.com/pricing): 3,000 emails/month, 100/day | Candidate only. [A domain you own/control must be verified](https://resend.com/docs/dashboard/domains/introduction). No free domain or unrestricted production email delivery is assumed. The local mailbox sends no actual email. |
| Payments | Direct-to-couple UPI, no platform gateway or custody; guest report plus manual couple bank-record check | Direction selected, live recipient setup not implemented. QR generation does not establish receipt. Do not promise bank/provider verification or universal zero bank/app fees. |

[Render's free-service documentation](https://render.com/docs/free) explicitly says not to use free instances for production. Web services sleep after 15 idle minutes, lose local files on restart, and free PostgreSQL expires after 30 days without backups. Do not use that database for persistent wedding records. [Supabase's default email delivery](https://supabase.com/docs/guides/auth/auth-smtp) is also not a production substitute: currently team-only recipients, 2 messages/hour and no delivery SLA without custom SMTP.

Managed hosting, databases and email introduce third-party data processors even when the application/authentication code is open source. Before enrollment, review regions, subprocessors, retention and terms with the owner. Email providers handle recipient addresses and authentication-message contents. Keep tracking disabled and don't include gift details in auth mail. [Neon documents TLS and encryption at rest](https://neon.com/docs/security/security-overview), but these do not prevent authorized provider access or application authorization bugs; free IP allowlisting/private networking is not assumed.

No external accounts, terms acceptance, real messages, paid plans, auto-recharge or public deployment are authorized by this evaluation. Stop at free limits rather than upgrading. The first publication target is a **private personal GitHub repository**, after user-controlled GitHub authorization. Incremental production work follows that checkpoint; no workplace account or data is to be used.

## Prerequisites and exact versions

Verified runtime: Node **26.13.0**, npm **11.20.0**, SQLite **3.54.0**. The project requires Node 26.13.x or later in the 26.x family for this exact demo. Upgrade to a reviewed supported runtime/database combination before a pilot; an LTS migration has not been tested.

Pinned direct dependencies:

| Dependency | Version |
|---|---|
| Next.js | 16.4.6 |
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| QRCode | 1.5.4 |
| Better Auth (self-hosted, MIT) | 1.7.21 |
| Vitest | 5.1.0 |
| Playwright Test | 1.65.0 |
| ESLint / eslint-config-next | 10.14.0 / 16.4.6 |
| @types/node | 26.6.6 |
| @types/react / @types/react-dom | 19.3.0 |
| @types/qrcode | 1.5.6 |

These were resolved from package-registry metadata, not invented. Playwright's `latest` tag was a prerelease, so stable 1.65.0 was selected instead. `package-lock.json` is generated by npm. Initial install emitted peer-dependency override warnings; lint, type-check and build executed successfully afterward. Full transitive compatibility is not guaranteed by that fact.

Publication preparation removed workplace package-feed URLs from the lockfile. Project `.npmrc` selects the public npm registry. All 497 rewritten tarball locations retain their original versions and integrity hashes; an isolated clean `npm ci --ignore-scripts --no-audit --no-fund` from public npm succeeded. This does not constitute a new advisory audit.

## Run on Windows PowerShell

```powershell
Set-Location 'C:\Users\hgadarla\projects\wedding-dream-wishlist'
npm ci --ignore-scripts --no-fund --no-audit
npm run demo:seed
npm run dev
```

Open `http://127.0.0.1:4317`. The guest example is `/w/tara-and-arjun`. At `/owner`, choose **Create an account**, use a fictional `your-name@example.test` address and a new 12-128 character password. No default account/password exists.

In another local project terminal run:

```powershell
npm run auth:mailbox
```

Open your verification link privately on this computer, then sign in. The mailbox is terminal-only, not an anonymous HTTP endpoint; no actual email is sent. Recovery uses the same local-only delivery adapter. **Never paste passwords or these links into chat.** Create your own wishlist to manage its reports; the old seeded example is not silently assigned to new accounts. Old shared demo sessions are invalidated; `/api/demo-session` returns 410.

No `.env` file is needed. The launcher generates a high-entropy secret in ignored `data\local-auth-secret.txt` and passes it only to the server. Keep that file private and preserve it with an appropriate separate secrets-backup process if restoring accounts. The launcher binds to `127.0.0.1`, fixes the expected origin and disables Next telemetry for that process. This does not control other applications' telemetry. Local filesystem users remain trusted; the mailbox/secret arrangement is not production identity infrastructure.

For the optimized local build:

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
npm run build
npm start
```

Do not expose either command through a public tunnel or reverse proxy. Running `next start` without the explicit local demo configuration returns 503 for app requests. A publicly deployed demo is not authorized.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'data\browsers'
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev --audit-level=low
```

Browser download is a development prerequisite, not a hosted service; it uses disk/network bandwidth. Browser binaries stay in ignored `data\browsers`. E2E starts an optimized loopback server on port 4318 with a separate synthetic database, never the main seed database. Do not have another server listening there. Firefox, Safari/WebKit, physical UPI apps and a real screen reader have not been tested.

See `docs/current-increment.md` for **current actual** verification and `docs/test-matrix.md` for the historical/full backlog. A test plan is not a passing test result. The latest advisory audit attempt was registry-rate-limited (HTTP 429); the old zero-advisory result does not cover this new dependency set.

## Synthetic reset, backup and recovery

Stop the app first (Ctrl+C in its terminal). Then:

```powershell
npm run demo:reset
npm run demo:backup
```

Reset is limited to the exact default `data\synthetic-demo.sqlite` and its WAL/SHM companions. It checks the synthetic database marker, deletes only those named files, then re-seeds. It refuses to reset a custom database path. This operation is **not** a production financial-history deletion feature.

Backup uses SQLite's backup API, copies the snapshot to an isolated restore-drill file and checks integrity, foreign keys, the synthetic marker and row counts including auth, recipient, contribution and claim-event tables. Backups contain private synthetic account/mailbox data. They remain in `data\backups`; the restore-drill copy is deleted. This is not encrypted off-site disaster recovery. Never commit data, backups or the auth secret.

To restore the synthetic demo: stop the server, keep a separate copy of the current database, copy a selected verified backup to `data\synthetic-demo.sqlite` and remove only the stopped database's named stale `-wal`/`-shm` files if present. Run the backup/drill again and check the seeded guest page. Never replace a live database. No automated production rollback or point-in-time recovery is implemented.

## Source map

```text
package.json / package-lock.json        pinned dependencies and executable commands
next.config.ts / src/proxy.ts           browser headers, loopback and demo gates
migrations/001_demo.sql                 actual executed schema, checks and audit triggers
migrations/002_auth_and_claims.sql      generated auth core schema, recipient/report/event tables
scripts/run-local.mjs                   loopback-only process launcher
scripts/seed.ts / backup.ts             fictional seed/reset and restore drill
src/lib/                               money, validation, types, strings, errors
src/server/                            SQLite connection, ownership store, sessions, HTTP guards
src/app/api/auth/[...all]/              maintained auth behind local origin/body/rate guards
src/app/api/demo-session/               retired shared entry (410)
src/app/api/owner/wishlists/             scoped list/create/read/state transitions
src/app/api/public/wishlists/[slug]/    anonymous allowlisted projection
src/app/owner/                          creation workspace and owner preview
src/app/w/[slug]/                       guest page
src/app/gift-status/                    private fragment-token status entry
src/app/api/guest/status/               scoped token lookup (POST, no token in server URL)
src/app/api/owner/wishlists/.../reports owner review and CSV export
src/components/                        forms, sharing controls and responsive goal view
tests/                                 unit, SQLite integration and real-browser tests
docs/                                  decisions, schema, API, threat model, test matrix, operations
```

## Implemented boundaries and honest limitations

- INR is parsed from plain decimal strings into safe, bounded integer paise. Targets: INR 0.01 to INR 1,00,00,000. Currency and owner/payment overrides are rejected.
- Up to 20 goals; bounded text/body sizes. No remote image fetching, uploads, HTML rendering, marketing, analytics, email or payment APIs.
- App/auth mutations require matching Host/Origin plus JSON. Token-protected auth verification/recovery GETs are maintained-library link ceremonies. Owner operations require an unexpired Better Auth session with verified email. Ownership is independent of display names; real HTTP cross-account isolation is tested.
- Guest reports are unverified. Only explicit authenticated owner confirmation adds to demo progress. Reversal appends an opposite ledger effect; no existing event is deleted. Duplicate references trigger review, never proof.
- Demo report limits: INR 1 to INR 1,00,000. A 256-bit private key is also its idempotency key; only its hash is stored. Names/messages stay private; aggregate progress may allow amount inference. Private status expires after seven days.
- Public responses are explicitly projected. No management token appears in guest links/QR. Private/draft/archived wishlists return unavailable. Paused/closed pages stay readable by design.
- State changes use transactions and version checks. Slugs are unique and immutable in this slice. No financial or wishlist hard-delete endpoint.
- Wedding dates are date-only; expiry is the exclusive next midnight IST stored as UTC. English UI, INR grouping and Unicode input are supported. Localization extraction is incomplete.
- SQLite queries are parameterized. Audit rows are append-only under ordinary SQL operations, **not tamper-proof against filesystem/database administrators**.
- CSP currently permits inline scripts/styles for Next rendering. Production mail delivery/identity lifecycle review, nonce-based CSP, Secure cookies/TLS, PostgreSQL, comprehensive accessibility verification and independent penetration testing remain launch blockers.

## Remaining increments - not implemented

2. PostgreSQL migration with a supported runnable environment, separate database lifecycle and restore/restart tests.
3. Live recipient UPI-ID/QR setup and secure changes, real verification/recovery delivery, account export/deletion and moderation/support.
4. Direct-UPI launch gating and chosen live overfunding policy. Provider integration remains disabled and is unnecessary for manual reporting.
5. Hardening, operational rehearsal, independent security/QA review and deployment preparation. Actual deployment requires explicit audience/cost approval.

This checkpoint completes local self-hosted auth and the synthetic manual-reporting increment. It does not claim that all requested production features are built.
