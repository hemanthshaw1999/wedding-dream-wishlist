# Wedding Dream Wishlist - local demo

**Demo - no real money. Use synthetic data only. This is not a production-ready or publicly deployed product.**

**Public source:** https://github.com/hemanthshaw1999/wedding-dream-wishlist. Public repository visibility does not deploy the application or enable real email/payments. Keep credentials, databases, private links and customer data out of Git.

**Production/Codex handoff:** [CODEX-HANDOFF.md](CODEX-HANDOFF.md) contains the implementation backlog, per-placeholder expectations and release checks. [.env.production.example](.env.production.example) contains non-working configuration placeholders with separate web/worker/migration scopes. Real values belong in approved secret stores; configuration alone does not complete missing features.

**Current increment:** real **PostgreSQL 18.7** persistence, restricted runtime role, concurrent/idempotent gift reports, audited confirmation/reversal and tested native backup/restore. Self-hosted **Better Auth 1.7.21 (MIT)** now also supports HTTPS-only production configuration and an encrypted, leased authentication-email queue. Local delivery remains a private fictional mailbox; the Resend adapter has only used a mocked transport, never real email. **See `docs/current-increment.md` for current results and launch blockers.**

**Goal management implemented:** owner-scoped add/edit/reorder/archive/restore, immutable revisions, public target-change history and preserved financial records. Reported purpose cannot be rewritten; target changes require acknowledgement and cannot fall below current confirmed progress.

**Runtime preparation implemented:** truthful `/api/health/ready`, minimum-schema and permission checks, an independently scoped email-only worker role, and separate Netlify web/worker configuration. Adapters are not deployed; provider bundling, scheduling, inbox delivery and combined free-tier compute/credit budgets remain unverified. See `docs/operations-and-launch.md` before configuring either project.

**Onboarding and consistency improved:** explicit signup/verification/sign-in steps, password visibility controls, safe return-to-wishlist navigation, responsive account screens, per-action submission locks and confirmation dialogs. Reports/totals/count/revision now use one owner-scoped SQL statement instead of eight queries; multi-query wishlist and whole-page owner reads use consistent PostgreSQL snapshots. **131 unit/integration tests and 20 desktop/mobile browser journeys passed**, plus lint/type-check/optimized build. This is measured query-count improvement, not a production latency or load guarantee.

## What actually runs

This project was created using GitHub Copilot CLI on Windows, not the Microsoft 365 Copilot application. No subscription entitlement was inspected or inferred. Java was not on PATH. Docker's executable exists but the checked daemon is unavailable. No cloud account, workplace repository, remote database, paid infrastructure or deployment was used.

The implementation now uses Next.js/TypeScript route handlers and PostgreSQL through `pg` 8.23.1. Spring Boot is not used. SQLite is no longer imported by the application, scripts or tests; old synthetic SQLite files are preserved, not silently migrated or deleted. PostgreSQL was downloaded from the official EDB binaries page and runs as an isolated, user-controlled loopback process, not a shared Windows service. See `docs/decisions.md`.

**Confirmed direction:** publicly hosted responsive application; PostgreSQL operated separately from web processes; direct-to-couple UPI without a gateway and guest-submitted reports, never automatic bank verification. PostgreSQL is implemented and tested locally; no hosted database or real UPI is enabled. Free-tier limits/audience, live overfunding policy, secure recipient setup, real mail delivery and deployment permission remain separate gates.

The server stores an actual on-disk database. Anonymous browsers can access intentionally published public/unlisted pages **on the same computer**. A loopback link is not a public website. A phone cannot reach its own computer's `127.0.0.1`; do not advertise the local QR as phone-ready.

## Free-service evaluation - 19 November 2026

These are researched candidates, **not configured provider accounts or deployments**. A disabled Resend adapter is implemented and tested against a local fixture. Free usage limits can change. Open-source software has no software license charge here; running it still needs compute, storage and operations. No service or software can guarantee zero data leaks.

| Component | Candidate and verified limits | Current status / important limitation |
|---|---|---|
| Login | Self-hosted Better Auth, MIT license | Local verification/recovery and HTTPS/Secure-cookie configuration tested. No hosted identity vendor required; real mail/worker provisioning remains blocked. |
| PostgreSQL | [Neon Free](https://neon.com/pricing): no card required, 1 GB/project, 100 CU-hours/project, 5 GB public egress/project; compute scales to zero after 5 minutes | Hosting candidate only; app already uses local PostgreSQL. Free recovery history is 6 hours with a 1 GB limit and one manual snapshot. Off-instance recovery is still required. |
| Web hosting | [Netlify Free](https://www.netlify.com/pricing/): 300 credits/month; production deploys cost 15 credits, compute 10 credits/GB-hour, bandwidth 20 credits/GB, web requests 2 credits/10k | Candidate only. [Next.js support uses OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/). Local project now targets supported Node 24, not Lambda's preview Node 26. Exact adapter/private-response caching/quotas/no-spend behavior still need verification. Default function region is Ohio; region customization requires Pro/Enterprise, so no free India-only residency is assumed. Do not expose the local mailbox configuration. |
| Transactional email | [Resend Free](https://resend.com/pricing): 3,000 emails/month, 100/day | Disabled adapter + encrypted retry queue tested with a local transport fixture. [A domain you own/control must be verified](https://resend.com/docs/dashboard/domains/introduction). No free domain or unrestricted production delivery is assumed. No actual email was sent. |
| Payments | Direct-to-couple UPI, no platform gateway or custody; guest report plus manual couple bank-record check | Direction selected, live recipient setup not implemented. QR generation does not establish receipt. Do not promise bank/provider verification or universal zero bank/app fees. |

[Render's free-service documentation](https://render.com/docs/free) explicitly says not to use free instances for production. Web services sleep after 15 idle minutes, lose local files on restart, and free PostgreSQL expires after 30 days without backups. Do not use that database for persistent wedding records. [Supabase's default email delivery](https://supabase.com/docs/guides/auth/auth-smtp) is also not a production substitute: currently team-only recipients, 2 messages/hour and no delivery SLA without custom SMTP.

Managed hosting, databases and email introduce third-party data processors even when the application/authentication code is open source. Before enrollment, review regions, subprocessors, retention and terms with the owner. Email providers handle recipient addresses and authentication-message contents. Keep tracking disabled and don't include gift details in auth mail. [Neon documents TLS and encryption at rest](https://neon.com/docs/security/security-overview), but these do not prevent authorized provider access or application authorization bugs; free IP allowlisting/private networking is not assumed.

No cloud-service enrollment, terms acceptance, real messages, paid plans, auto-recharge or public deployment are authorized by this evaluation. Stop at free limits rather than upgrading. The owner separately authorized and completed personal GitHub login; the initial checkpoint was pushed to a **private personal repository**. No workplace account or data is used.

## Prerequisites and exact versions

Current project runtime: Node **24.22.3 LTS (Krypton)**, npm **11.19.1**, PostgreSQL **18.7**. `.node-version` pins the build/runtime family; `package.json` requires Node 24.22.3 or later within 24.x. The official portable Windows archive was checked against its official SHA256 manifest: `E612AF99F626AB415EA225AF6BCE5C971FEB448CB5CAE250BB1C3FA50C5F7D9F`.

Earlier local checkpoints used Node 26.13.0 LTS successfully. However, [AWS still marks its Node 26 Lambda runtime as preview/not for production](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html). [Netlify's function runtime](https://docs.netlify.com/build/functions/configuration/?fn-language=js#node-js-version-for-runtime) follows supported Lambda versions and documents a Node 24 fallback. The project therefore targets stable Node 24 rather than relying on a host's silent runtime fallback. This is local runtime compatibility work, not a verified hosted OpenNext deployment.

Pinned direct dependencies:

| Dependency | Version |
|---|---|
| Next.js | 16.4.6 |
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| QRCode | 1.5.4 |
| Better Auth (self-hosted, MIT) | 1.7.21 |
| pg / @types/pg | 8.23.1 |
| Vitest | 5.1.0 |
| Playwright Test | 1.65.0 |
| ESLint / eslint-config-next | 10.14.0 / 16.4.6 |
| @types/node | 24.19.2 |
| @types/react / @types/react-dom | 19.3.0 |
| @types/qrcode | 1.5.6 |

These were resolved from package-registry metadata, not invented. Playwright's `latest` tag was a prerelease, so stable 1.65.0 was selected instead. `package-lock.json` is generated by npm. Initial install emitted peer-dependency override warnings; lint, type-check and build executed successfully afterward. Full transitive compatibility is not guaranteed by that fact.

Publication preparation removed workplace package-feed URLs from the lockfile. Project `.npmrc` selects the public npm registry. All 497 rewritten tarball locations retain their original versions and integrity hashes; an isolated clean `npm ci --ignore-scripts --no-audit --no-fund` from public npm succeeded. This does not constitute a new advisory audit.

## Run on Windows PowerShell

```powershell
Set-Location 'C:\Users\hgadarla\projects\wedding-dream-wishlist'
# On this computer only, select the isolated official Node 24 installation:
$env:PATH = 'C:\Users\hgadarla\.local\share\wedding-wishlist-tools\node-v24.22.3-win-x64;' + $env:PATH
node --version
npm ci --ignore-scripts --no-fund --no-audit
npm run db:local
```

Keep PostgreSQL running in that terminal. It needs a supported PostgreSQL installation: set `PG_BIN` to its bin directory, or use the verified portable 18.7 installation on this computer. No machine-wide service/admin privilege is required. In a second project terminal:

```powershell
npm run db:migrate
npm run demo:seed
npm run dev
```

Open `http://127.0.0.1:4317`. The guest example is `/w/tara-and-arjun`. At `/owner`, choose **Create an account**, use a fictional `your-name@example.test` address and a new 12-128 character password. No default account/password exists.

In another local project terminal run:

```powershell
npm run auth:mailbox
```

Open your verification link privately on this computer, then use **Continue to sign in** with the same email and password. The signup confirmation preserves your email, clears the password and offers verification resend. The mailbox is terminal-only, not an anonymous HTTP endpoint; no actual email is sent. Recovery uses the same local-only delivery adapter. **Never paste passwords or these links into chat.** Create your own wishlist to manage its reports; the old seeded example is not silently assigned to new accounts. Old shared demo sessions are invalidated; `/api/demo-session` returns 410.

No `.env` file is needed locally. Database credentials are generated in ignored `data\local-postgres.json`; a persistent cluster lives in `data\postgres-cluster`. Keep both private. Schema migrations use a separate owner role; the running app cannot create/alter tables, overwrite migration history or delete ledger/audit rows. App startup rejects administrator roles. The launcher generates a high-entropy auth secret in ignored `data\local-auth-secret.txt`, binds to `127.0.0.1`, fixes the expected origin and disables Next telemetry. Better Auth telemetry is explicitly disabled. This does not control other software's telemetry. Local filesystem users remain trusted; the mailbox/secrets setup is not production identity infrastructure.

For the optimized local build:

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
npm run build
npm start
```

Do not expose these local commands through a public tunnel or reverse proxy. Unconfigured app requests return 503. `npm start` explicitly refuses `APP_ENV=production`; it does not switch a local demo into a hosted release.

## Production identity preparation - not launch approval

`npm run start:production` is a separate, fail-closed Node entrypoint. It requires `APP_ENV=production`, an exact HTTPS `APP_ORIGIN`, a separately generated 48-byte hex auth secret, an appropriately marked/migrated **production** PostgreSQL database and a restricted non-owning runtime role. It rejects the local demo gate and does not create/migrate a database itself. Managed/serverless hosting must still be validated separately; merely setting environment variables is not a tested deployment.

Production authentication additionally requires a verified sender, separately generated 32-byte email encryption key and explicit `EMAIL_DELIVERY_APPROVED=resend-free`/`EMAIL_SENDER_VERIFIED=yes` attestations. These flags are **operator approvals, not automated checks of DNS, legal compliance or the provider's plan**. Keep them unset until approved setup. The `.env.example` contains placeholders only. Keep the provider API key on the worker, not in the browser or source repository.

Authentication requests enqueue AES-256-GCM encrypted address/link/message payloads in PostgreSQL. Only the worker decrypts for the provider call. Verification jobs stop retrying after 25 minutes, recovery jobs after 10 minutes; the underlying auth library independently enforces token expiry. Finalized/expired payloads are cleared during processing, and final metadata is pruned after seven days during worker runs. An offline worker delays expiry cleanup; this is not database-wide encryption or protection against a compromised app server. Library authentication/session records use the maintained library's own storage format.

After provider/account/sender/region/terms/free-plan approval and secure configuration, `npm run auth:deliver` processes **at most one job**. Arrange supervised invocations at least once per minute on an approved host, monitor queue delay/outcomes, and alert if processing stops. No scheduler or live worker is provisioned. The worker never prints addresses, URLs, credentials or provider error bodies.

The fixed HTTPS [Resend send endpoint](https://resend.com/docs/api-reference/emails/send-email) uses persisted [`Idempotency-Key`](https://resend.com/docs/dashboard/emails/idempotency-keys) values. Provider retention is 24 hours; application retries expire much sooner. Row leases, fencing tokens, retries/backoff and maximum five attempts handle worker crashes and uncertain acknowledgements. `accepted` means the provider acknowledged an email ID, **not inbox delivery**. Unknown outcomes are not labeled delivered. No email webhook/tracking pixel is enabled.

Persistent UTC budgets count **all transport attempts, including retries**, with conservative ceilings of 90/day and 2,700/month. They cannot be raised through worker options. Exhaustion stops processing, not paid upgrades. This cannot control other applications/manual sends on the provider account or establish the account's billing plan; use an approved dedicated setup and disable paid/automatic upgrades with the provider. Real sender verification, delivery/recovery, queue scheduling, no-spend behavior and exact hosting/runtime support remain launch gates. No product launch or real UPI is enabled by this increment.

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

See `docs/current-increment.md` for **current actual** verification and `docs/test-matrix.md` for the historical/full backlog. A test plan is not a passing test result. A fresh `npm audit --omit=dev --audit-level=low` completed with **0 reported production dependency vulnerabilities** for the current lockfile; it does not prove that the application is secure or cover development dependencies.

## Synthetic reset, backup and recovery

Stop the app first (Ctrl+C in its terminal). Then:

```powershell
npm run demo:reset
npm run demo:backup
```

Reset refuses external database configuration and requires the app to be stopped. It creates a new, marked synthetic PostgreSQL database and updates local configuration; the previous database is **preserved**, not deleted. It is not a production financial-history deletion feature or account-deletion policy. Old SQLite files remain untouched.

Backup uses native `pg_dump` custom format with an exported repeatable-read snapshot. It restores into a fresh isolated database and checks row counts, environment marker and ledger/state reconciliation. This includes a tested nonempty auth/confirmed-contribution fixture, not only an empty schema. Credentials go through child-process environment, never command-line URLs or logs. Private backup data stays in ignored `data\backups`; the isolated restore database is dropped after validation. It is not encrypted off-site disaster recovery. Never commit data, backups or auth secrets.

For recovery, restore a verified `.dump` to a new empty database using matching supported `pg_restore`, validate the marker/counts/ledger, grant the restricted runtime role, and only then switch server-side configuration. Preserve the old database and independent auth secret. Do not copy SQLite files into PostgreSQL or overwrite a live database. The automated drill exercises restoration, but production cutover and off-instance/PITR recovery remain unimplemented.

## Source map

```text
package.json / package-lock.json        pinned dependencies and executable commands
next.config.ts / src/proxy.ts           browser headers, loopback and demo gates
migrations/001_demo.sql                 actual executed schema, checks and audit triggers
migrations/002_auth_and_claims.sql      generated auth core schema, recipient/report/event tables
migrations/postgres/                  current PostgreSQL schema/auth/fix migrations
scripts/local-postgres.mjs             separate loopback database process, generated credentials
scripts/migrate.ts                     explicit migration owner and restricted runtime grants
scripts/run-local.mjs                   loopback-only process launcher
scripts/seed.ts / backup.ts             fictional seed/reset and restore drill
src/lib/                               money, validation, types, strings, errors
src/server/                            PostgreSQL pool/transactions, ownership, auth, HTTP guards
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
tests/                                 unit, real PostgreSQL integration and browser tests
docs/                                  decisions, schema, API, threat model, test matrix, operations
```

## Implemented boundaries and honest limitations

- INR is parsed from plain decimal strings into safe, bounded integer paise. Targets: INR 0.01 to INR 1,00,00,000. Currency and owner/payment overrides are rejected.
- Up to 20 retained goals, including archived goals; bounded text/body sizes. No remote image fetching, uploads, HTML rendering, marketing, analytics or payment APIs. The disabled email adapter uses only a fixed provider endpoint after separate approval.
- App/auth mutations require matching Host/Origin plus JSON. Token-protected auth verification/recovery GETs are maintained-library link ceremonies. Owner operations require an unexpired Better Auth session with verified email. Ownership is independent of display names; real HTTP cross-account isolation is tested.
- Guest reports are unverified. Only explicit authenticated owner confirmation adds to demo progress. Reversal appends an opposite ledger effect; no existing event is deleted. Duplicate references trigger review, never proof.
- Demo report limits: INR 1 to INR 1,00,000. A 256-bit private key is also its idempotency key; only its hash is stored. Names/messages stay private; aggregate progress may allow amount inference. Private status expires after seven days.
- Public responses are explicitly projected. No management token appears in guest links/QR. Private/draft/archived wishlists return unavailable. Paused/closed pages stay readable by design.
- State changes use transactions and version checks. Slugs are unique and immutable in this slice. No financial or wishlist hard-delete endpoint.
- Wedding dates are date-only; expiry is the exclusive next midnight IST stored as UTC. English UI, INR grouping and Unicode input are supported. Localization extraction is incomplete.
- PostgreSQL queries are parameterized. Exact integer-paise NUMERIC constraints reject fractional stored paise without rounding; the driver returns exact strings converted only after safe-integer checks. UTC ISO timestamp domains reject malformed dates; auth uses TIMESTAMPTZ.
- Database transactions use per-key advisory locks and row locks for real concurrent retries/reviews/state changes. Deferred ledger constraints reject status/totals divergence at commit. Runtime grants protect history even if an application query is mistaken; administrators can still bypass database controls.
- Remote PostgreSQL connections always verify TLS certificates; URL options cannot disable this. App startup and migration roles are separate. No runtime fallback to SQLite or an in-memory database exists.
- Scripts use fresh per-request CSP nonces and strict-dynamic without production unsafe-inline/eval; all pages render dynamically. Inline styles remain allowed for existing progress bars/Next styling. Actual parser-injected script blocking, hydration and development HMR were tested. This is defense in depth, not a substitute for safe rendering. Secure auth cookies are tested through HTTPS library requests; actual hosting/TLS/mail delivery, identity lifecycle review, comprehensive accessibility verification and broader security assessment remain launch blockers.

## Remaining increments - not implemented

2. Hosted PostgreSQL provisioning, encrypted off-instance backups and deployment rehearsal.
3. Live recipient UPI-ID/QR setup and secure changes, real verification/recovery delivery, account export/deletion and moderation/support.
4. Direct-UPI launch gating and chosen live overfunding policy. Provider integration remains disabled and is unnecessary for manual reporting.
5. Hardening, operational rehearsal, independent security/QA review and deployment preparation. Actual deployment requires explicit audience/cost approval.

These checkpoints add PostgreSQL durability, HTTPS identity/email-delivery preparation, stable Node 24 compatibility and nonce-based script protection. They do not claim that all requested production features are built.
