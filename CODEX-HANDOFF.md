# Production v1 handoff

**Status: implemented local application, not production-ready or publicly deployed.**
This handoff supplies placeholders and expectations; it does not certify unfinished code.
Configuration alone cannot enable real UPI, implement goal management or deploy a worker.
No real credentials, payment addresses or customer data belong in this document.

Private repository: https://github.com/hemanthshaw1999/wedding-dream-wishlist

## Copy-paste task for Codex

```text
Read CODEX-HANDOFF.md, README.md, docs/current-increment.md and relevant source before editing.
Complete the wedding wishlist production v1, not just its deployment configuration.
Use the existing Next.js/TypeScript, PostgreSQL and self-hosted Better Auth architecture.
Keep working through the implementation gaps below with small, tested commits.
Keep this personal repository private; do not use workplace accounts, code or credentials.

Use placeholders only for operator-supplied configuration and documented pending decisions.
Do not replace business logic, tests, authentication, payment checks or error handling with stubs.
Never treat a placeholder, screenshot, QR, redirect or guest declaration as a verified payment.
Do not silently enable real money or convert an existing demo wishlist into a live one.

Implement and test locally without needing cloud credentials.
Run the relevant checks and record exact results; do not report checks that were not run.
Use isolated synthetic PostgreSQL databases, never customer databases, for tests.
When an external value is missing, finish independent local work and record the precise missing value.
Do not weaken security checks or invent success responses to bypass a missing value.

Get the owner's approval before provider enrollment/terms, external messages, public exposure,
billing, domain purchases, recipient onboarding or real transfers.
Actual secrets must go directly into approved secret stores, never chat, git or browser bundles.
Recheck free-plan terms, region, hard spending controls and runtime support before provisioning.
Do not claim production readiness until every applicable release gate below has evidence.
```

## Product and architecture

Couples create INR-denominated wedding goals and share responsive public/unlisted pages.
Guests do not need an account to view or report a gift. Couples must authenticate and verify
their email. Private wishlists remain owner-only. No platform custody or payment gateway is
planned for v1: guests pay a couple directly and the couple checks their own bank records.

```text
Guest / authenticated couple
        -> canonical HTTPS origin
        -> Next.js pages + server-side API/auth/authorization
        -> independently hosted PostgreSQL
             -> immutable contribution/event history
             -> encrypted authentication-email outbox
        -> scheduled email worker -> approved email provider

Future direct-UPI instructions -> guest's UPI app -> couple's bank
Guest declaration -> private owner review -> manually confirmed progress
There is no automatic bank confirmation callback in this design.
```

Next.js/React/TypeScript and the existing maintained Better Auth library remain the stack;
do not introduce a second backend or paid identity platform without a demonstrated need.
The tested application runtime is Node 24.22.3 LTS; honor `.node-version` and `package.json`.
Local PostgreSQL is 18.7. Validate the selected managed PostgreSQL version and connection
pooler against the actual migrations, locks, library auth and concurrency tests.

Netlify Free, Neon Free and Resend Free are researched candidates, not provisioned resources
or a promise of free operation. The owner must approve actual terms, processing regions,
limits and no-spend controls. Better Auth is self-hosted open-source authentication;
transactional email still needs a delivery service or a separately operated mail server.
A provider hosting address can avoid buying a web domain, but arbitrary-user email delivery
through the current adapter still requires a provider-verified controlled sender domain.
Do not quietly bypass email verification or expose the terminal mailbox to avoid that requirement.

## Actual environment placeholders

`.env.production.example` is a reference, not a loaded configuration file. Use independent
secret sets for production and staging. Populate only each service's assigned values in
its approved secure configuration; do not upload a filled reference file.
None of these values is a browser variable.

| Variable / scope | Placeholder expectation | Acceptance check |
|---|---|---|
| `APP_ENV` / web, worker, migration | Literal `production` for a production-mode environment | Configuration rejects mixing it with the local demo gate; migrations write/check the production marker. |
| `APP_ORIGIN` / web, worker | `https://<approved-canonical-host>` without path, credentials or trailing slash | Actual HTTPS/Host/Origin checks, auth links and redirects work only for the intended canonical origin. Test the deployed proxy, not just localhost. |
| `DATABASE_URL` / web, worker | Provider connection URL for a dedicated non-owning runtime role; percent-encode credentials; remote TLS required | `Database.ready()` accepts the environment and least-privilege role. No superuser, role/database creation, schema CREATE, table ownership or owner-role membership. |
| `BETTER_AUTH_SECRET` / web only | Cryptographically generated, independent 48 random bytes encoded as exactly 96 hex characters | Invalid/missing values fail closed. Auth uses Secure/HttpOnly/SameSite cookies; expiry, logout and recovery revoke access. Never reuse an example secret. |
| `EMAIL_OUTBOX_KEY` / web, worker | A separate 32 random bytes encoded as exactly 64 hex characters; identical between producers/workers in one environment | Queue ciphertext decrypts only with the approved key. Back up the key separately; plan draining/versioning before rotation, not blind replacement. |
| `EMAIL_FROM` / web, worker | `accounts@<provider-verified-domain>`; bare email, not a display-name string | Provider domain verification succeeds; approve real delivery tests. A plausible address in configuration does not prove sender ownership. |
| `EMAIL_DELIVERY_APPROVED` / web, worker | Leave unset until approval, then exactly `resend-free` for the implemented adapter | Document owner approval of provider, current free plan, sender and data processing. This flag is an operator attestation, not automatic provider verification. |
| `EMAIL_SENDER_VERIFIED` / web, worker | Leave unset until actual verification, then exactly `yes` | Save non-sensitive verification evidence. Do not set merely to silence startup errors. |
| `RESEND_API_KEY` / worker only | Real least-privilege sending key scoped to the approved domain where supported | Authorized verification/recovery emails reach controlled inboxes. Logs never contain tokens, addresses, message bodies or keys. Provider acceptance alone is not inbox delivery. |
| `MIGRATION_DATABASE_URL` / migration job only | Separate schema-owner connection to the same intended database, preferably a direct connection | Apply additive migrations with this credential; never expose it to web/worker processes. Do not reuse the runtime role or point at an unrelated database. |
| `DATABASE_RUNTIME_ROLE` / migration job only | Exact name of the pre-provisioned restricted app role | `npm run db:migrate` grants runtime permissions successfully; subsequent runtime readiness and denial tests pass. The script does not create the database/roles. |
| `PORT` / standalone web only | Integer 1024-65535, normally provided by the host; default `3000` | Private Node listener is reachable through trusted HTTPS termination, not exposed as a public plaintext login server. Serverless platforms use their adapter instead. |
| `NEXT_TELEMETRY_DISABLED` / build, web | Literal `1` | Set before build as well as runtime; no added analytics/error collector without separate privacy review. |

Generate and deliver secrets directly to the secret store using a cryptographically secure
generator. Do not print them into an assistant session or request the owner's passwords/OTPs.
Provision roles through an approved secure operator process; do not commit SQL containing
real passwords. Test restoration with access to separately protected required keys.

`npm start` and `npm run dev` are intentionally **local demo launchers**, not hosting commands.
The standalone production entrypoint is `npm run start:production`; it validates auth/email,
database marker, restricted role and schema version before listening. Current schema versions
are 001-004. Raise required-version checks when adding migrations; never rewrite applied SQL.

A Next.js serverless adapter may bypass that standalone entrypoint. Implement equivalent
deployment/readiness checks for the selected adapter and verify its CSP nonce propagation,
private-response/no-store handling, cookies, TLS and connection limits. A `200` home page
does not prove database/email readiness. No dedicated health/readiness endpoint or scheduler
is currently implemented; do not configure fictional endpoints and call them working.

## Owner/product placeholders, not existing environment switches

These are decisions or application features to finish, **not environment variables that the
current code reads**. Collect sensitive recipient data only through the finished secure UI.

| Input | Expected value / provisional assumption | Required implementation or proof |
|---|---|---|
| `<hosting-account-and-origin>` | Owner-controlled personal account and an approved HTTPS hosting address | Owner signs in personally; verify project ownership, audience, region, free quotas and hard no-spend controls. Never enroll using workplace credentials. |
| `<database-project-and-region>` | Separate durable PostgreSQL project; staging and production isolated | Approve processing locations and recovery limits. Web restart must not recreate or erase the database. Test pooler/concurrency budgets; the current pool limit is 10 per process, not a global serverless limit. |
| `<email-domain-and-worker-host>` | Controlled verified sender domain plus a scheduler permitted by the approved plan | Current `auth:deliver` handles one job per invocation. Implement supervised scheduling at least once/minute with measured backlog/expiry behavior and conservative existing quotas. No scheduler is deployed. |
| `<live-payment-mode>` | Direct-to-couple UPI, no gateway or platform balance | Implement separately versioned live setup/instructions. The current database only permits `demo`; setting `PAYMENT_MODE=upi` does nothing. Keep demos visibly non-payable. |
| `<recipient-upi-id-and-label>` | Couple enters their own recipient address and human-readable label after reauthentication | Validate syntax without claiming bank ownership verification. Confirm bank-app recipient details before paying. Store immutable recipient versions and bind instructions/reports to the actual version shown. |
| `<funding-policy>` | Proposed v1: allow overfunding and show truthful totals; owner has not approved a live policy | Build/test the chosen policy explicitly. A hard cap would require a late-payment/reservation policy, not just hiding a button at 100%. Do not activate real money while undecided. |
| `<payment-report-and-confirmation-policy>` | Guest supplies a declaration; owner confirms only after checking bank records | Separate reported/review/rejected/manual-confirmed amounts. QR, screenshots, references and redirects never prove receipt. A reversal is not a bank refund. No automatic verification or refund promise. |
| `<public-support-contact>` | An owner-monitored support address and published response expectations | Implement a real contact/abuse route, scoped support access and audited suspension/recovery. No default administrator password or universal money-editing endpoint. |
| `<privacy-terms-and-retention>` | Reviewed notices, public-field disclosures, processing regions and explicit retention/erasure rules | Implement account export/deletion and retention handling. Do not invent compliance, tax benefits, statutory retention periods or eligibility. Financial audit retention versus erasure needs qualified review. |
| `<backup-destination-and-key>` | Approved encrypted off-instance storage with separate key/access controls | Implement production backup/restore and retention. Current `demo:backup` deliberately refuses production data; do not remove its guard to claim production backups. |
| `<recovery-and-availability-targets>` | Owner-approved RPO/RTO, incident contact and acceptable free-tier downtime | Measure isolated restore and outage recovery. One database/free host is not high availability; app restart survival is not disk/region-loss protection. |

## Implementation still required

These are real code tasks, not missing credentials. Finish them before representing the
application as production-ready. Existing local flows must remain usable while work proceeds.

1. **Goal management and historical purpose.** Add/edit/reorder/archive/restore goals through
   owner-scoped APIs and accessible desktop/mobile controls. Use additive PostgreSQL migrations,
   immutable history, bounded projections and optimistic versions. Preserve contribution links
   and confirmed progress on archive; disallow new reports for archived goals. Make post-report
   purpose/target changes explicit and auditable, never silently rewrite a guest's historical
   terms. Reject a changed target below current net confirmed value. Serialize goal mutations,
   new reports and confirmations using a consistent database lock order; test races/rollbacks.
   Keep private owner reasons/identities out of public target-history projections.
2. **Live direct-UPI vertical slice.** Implement authenticated recipient setup, recent
   reauthentication, immutable versioned recipient/instruction snapshots, reviewed live
   activation and stale-instruction/late-report behavior. Preserve existing idempotent private
   receipts even after pause/archive. Guests may report an amount they actually paid; no
   platform charge is required. Screenshots are optional unverified evidence only; leave
   uploads disabled unless a private, bounded, safe upload/retention pipeline is implemented.
   Never retroactively switch published demo histories into real-money histories.
3. **Privacy, safety and support.** Implement account export/deletion with session revocation,
   actual retention jobs, abuse reporting/moderation and least-privilege support operations.
   Keep financial corrections append-only. Preserve CSV formula-injection defense and private
   guest status. Unlisted links are bearer links, not authenticated privacy; disclose this.
   Do not add analytics, public donor identities or external image fetching by default.
4. **Deployable web and worker.** Add tested provider-specific configuration for the chosen
   supported Node 24 runtime, migration job and bounded email scheduler. Check serverless
   startup/readiness, concurrency/pool budgets and strict origin/cookie/CSP/cache behavior.
   Monitor queue age, expired/failed/unknown jobs and delivery quotas without logging personal
   payloads. Do not label an unscheduled CLI or mocked transport as working production email.
5. **Production recovery and operations.** Implement encrypted off-instance backups, scheduled
   restore checks, non-sensitive readiness/monitoring, redacted incident logs and a release/
   compatible-app-rollback runbook. Preserve environment markers and ledger constraints on
   restore. Back up before migrations. A restored instance must be isolated from live email
   and public traffic until deliberately approved.
6. **Release assurance.** Add focused regression tests for new behavior and actual CI.
   Exercise owner/guest isolation, auth abuse/session expiry, INR parsing, idempotency, ledger
   reconciliation, concurrent target/report/confirmation changes, stale/offline retries,
   keyboard/accessibility, 320px/mobile layouts and real-device/browser/slow-network flows.
   Run a full-product security review, then deploy only with explicit owner approval.

Useful starting points: `src\server\store.ts`, `claims-store.ts`, `database.ts`, `auth.ts`,
`email.ts`, `src\lib\wishlist.ts`, `src\components\owner-controls.tsx`,
`guest-report.tsx`, `wishlist-view.tsx`, `migrations\postgres`, `tests` and `scripts`.
Existing schema and role protections must be extended consistently with new history tables,
native restore checks and the production minimum-schema check.

## Validation expectations

The existing evidence is local and synthetic, not a hosted acceptance certificate:

| Check | Last recorded evidence before this documentation handoff |
|---|---|
| Full Node 24 unit/integration suite | 104 passing tests across 8 files before the final two CSP tests were added. |
| Focused HTTP/CSP suite | 10 passing tests, including the two new nonce tests; not a new full-suite result. |
| Desktop/mobile browser journeys | Six existing journeys covered after CSP hardening; the two changed full-gift journeys were rerun successfully after correcting the parser-injection probe. |
| Lint, TypeScript, optimized build | Passed on Node 24; nonce-dependent pages dynamically render. |
| PostgreSQL durability and restore | Project-process restart preserved synthetic counts; native isolated restore includes auth, confirmed ledger and encrypted queued-email fixtures. Not off-instance disaster recovery. |
| Production dependency audit | Zero reported advisories at last check; not a guarantee or a development-dependency audit. Recheck before release. |
| Prior security review | No findings in the scoped auth/email increment. Not a full-product review; deployed TLS/Host/Origin/cache, role provisioning and real email remain unverified. |
| Live deployment, inbox delivery, UPI | Not performed. No cloud accounts/resources, real provider transport, payable UPI instructions or public launch are configured. |

Use Node from `.node-version`. Test commands need an isolated loopback PostgreSQL instance,
with `pg_dump`/`pg_restore` available through `PG_BIN` or the documented local installation.
`WISHLIST_TEST_ADMIN_URL`, if used, must reference a dedicated **local test administrator**,
never a remote/customer database; fixtures create/drop generated test databases and roles.
The existing `npm run db:local` starts a long-running project-only development PostgreSQL
process. Do not start a second copy if it is already running, or manipulate shared services.

Run in a separate development shell without production secrets. Install dependencies only
when needed. Stop only this project's optimized preview before rebuilding the same `.next`;
do not kill other Node/PostgreSQL processes. Example release-validation sequence:

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
npm ci --registry=https://registry.npmjs.org --ignore-scripts --no-fund --no-audit
npm run lint
npm run build
npm run typecheck
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'data\browsers'
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev --registry=https://registry.npmjs.org
```

The build precedes type-check/E2E because generated Next route types and the optimized
server are needed on a fresh checkout. Browser emulation is not real-device verification.
Record exact counts, commands and remaining failures; do not reuse old passing counts after
changing the application. Review any new runtime dependency advisories rather than assuming
an audit exit code establishes product security.

## Public release gate

- [ ] Remaining selected v1 features above are implemented, reviewed and tested; no fake handlers.
- [ ] Owner approves live funding policy, recipient setup, notices and support/retention rules.
- [ ] Actual personal provider ownership, regions, terms and hard no-spend controls are verified.
- [ ] Production/staging origins, databases, secrets and email configuration are isolated.
- [ ] Migrations and runtime-denial checks pass; no privileged credential reaches web/worker.
- [ ] Deployed auth verification/recovery/logout, tenant isolation and anonymous guest flows pass.
- [ ] Worker scheduling, inbox delivery, backlog expiry, retries and quotas are actually verified.
- [ ] Responsive/accessibility/browser/security checks pass on the release artifact.
- [ ] Encrypted off-instance restore, incident response and compatible rollback are rehearsed.
- [ ] Owner explicitly approves public exposure and separately approves any real-money pilot.

Until then, retain **Demo - no real money** and describe the exact remaining gate honestly.
No guarantee of zero data leaks, free perpetual hosting, automatic bank verification,
uninterrupted availability or legal compliance is made.
