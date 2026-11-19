# Deployment preparation and launch blockers

For current implementation status, placeholders, service scopes and Codex instructions, start with `..\CODEX-HANDOFF.md` and `current-increment.md`. The checklist and source log below include historical checkpoint-1 material; the handoff distinguishes implemented PostgreSQL/auth from unfinished features and external setup.

**Private personal GitHub publication was authorized and completed. No public deployment, hosting/email-provider enrollment, domain purchase, paid service, external provider terms acceptance, recipient onboarding or real payment was performed.** External setup and public exposure still need explicit owner approval. These are review instructions, not executed actions.

## Environment plan

**Confirmed target:** publicly hosted, responsive app with anonymous external guests. Local-only is an incremental test environment, not the intended launch scope. The actual database is now PostgreSQL, separate from application processes and on durable storage. Hosted PostgreSQL provisioning remains undone; no SQLite-to-production conversion is claimed.

1. **Local synthetic demo (now):** loopback-only Node + PostgreSQL, separate authenticated fictional accounts and terminal-only mail, no real transfers. Build/test artifact is executable locally, not a public product.
2. **Private staging (future approval):** separate reviewed runtime, maintained auth, PostgreSQL and migrations, synthetic data and approved controlled email tests only. Network audience must be explicitly approved. No production credentials/data copied into staging.
3. **Pilot/production (separate approval):** HTTPS and a real domain/approved hosting address, isolated credentials/PostgreSQL, defined owners, financial/legal/provider gates, monitoring and restore procedure.

Failure domains: app process down -> database remains intact and app can restart; database process down -> fail writes honestly and recover/restart without inventing success; disk/host loss -> recover from a separately stored backup or replica; regional/provider loss -> requires a separately approved disaster-recovery strategy. One PostgreSQL instance alone is not high availability, and a backup kept on the same failed machine is not disaster recovery.

Do not upload the default local-demo configuration to hosting. The default launcher is intentionally local-only. Maintained authentication and production identity/email configuration are implemented, but deployment, live email and remaining product features are not. Removing a gate is not a production migration. Retain the existing Next.js/TypeScript/PostgreSQL architecture and verify the chosen hosting adapter/runtime before launch.

## Approval request format - before each external action

Explain the exact action, service/account owner, audience/data exposure, recurring/usage cost and hard limit, external terms, reversibility and secrets-handling mechanism. Obtain explicit approval. Never collect passwords, OTPs, PAN, bank details or payment secrets in chat. Owner/merchant information belongs in an approved secure provider-managed setup.

## Prepared Netlify adapters - not deployed

The repository now provides separate web and mail-worker project configurations. This
does not create accounts, accept terms, authorize live email or establish free-tier fit.
Use **two independently configured personal projects** so the mail-provider key never
enters the Next.js web runtime.

| Project | Base directory | Package directory (Netlify UI) | Configuration / expected output |
|---|---|---|---|
| Web | Repository root (leave unset) | `deploy/web` | `deploy\web\netlify.toml`: builds the actual Next.js application and publishes `.next` through the OpenNext adapter. |
| Mail worker | Repository root (leave unset) | `deploy/mail-worker` | `deploy\mail-worker\netlify.toml`: functions-only site, no Next.js framework integration, static notice plus the scheduled `auth-email` function. |

These are Netlify configuration paths; the build commands in TOML run on Netlify's
Bash/Linux build host. Both projects install from the repository-root lockfile. The worker
package manifest is framework-detection metadata, not a second dependency installation.
Verify that the worker build log contains only the intended scheduled function, not a
second Next.js application. Netlify bundles functions after the syntax-check build command;
local TypeScript/syntax tests do not prove its hosted bundling or scheduling works.

Set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` through the **Netlify UI/API**, not TOML, for both
projects. Restrict secrets to the intended production runtime/context; do not copy production
secrets into branch/deploy previews. Disable previews until independently configured staging
has its own approved origin, database, keys and delivery audience.

Provision distinct schema-owner, web-runtime and email-runtime database roles. Run
`npm run db:migrate` only in a controlled migration job with `APP_ENV=production`,
`MIGRATION_DATABASE_URL`, `DATABASE_RUNTIME_ROLE` and `DATABASE_EMAIL_ROLE` securely set.
The optional email-role argument grants only schema usage, metadata reads and email
outbox/budget operations; it does not create the role or database. The worker rejects
an administrator, schema owner, wrong environment, outdated schema or broad web-role
access. It opens/closes its own pool per invocation, never falling back to local credentials.

Use the web `DATABASE_URL` only in the web project. Set the worker `DATABASE_URL` to the
same database using the **email-only** role. Give only the worker `RESEND_API_KEY`; share
the intended origin/sender/approval/encryption-key values within that environment.
Neither runtime gets migration credentials. A deliberate encryption-key rotation needs
queue draining/versioned keys and separately protected key backup.

`GET /api/health/ready` returns only `{"status":"ready"}` or a 503 unavailable status with
a random correlation ID; private errors are redacted. It checks auth/email configuration,
database marker, restricted role, minimum schema, actual database liveness and all required
web grants. This is not inbox delivery, bank verification or financial feature readiness.
The same minimum-schema guard applies to guarded database pools, including serverless
entrypoints that do not execute `start:production`.

The scheduled function runs at most one leased job per invocation and signals failed,
unknown, quota, retry and lease-lost outcomes without private exception text. The supplied
schedule is once/minute UTC. Netlify documents a 30-second limit and no direct production
URL invocation for scheduled functions; verify the deployed badge, schedule and controlled
`Run now` behavior before sending approved verification/recovery tests.

**Free-tier warning:** minute polling repeatedly opens the database and can prevent
scale-to-zero. Do not approve the researched Neon 100 CU-hour free allowance merely
because the email count is small. Calculate idle compute, all web/worker Netlify credits,
traffic and storage together, then verify actual no-spend limits. Never upgrade or add
billing silently. A different approved PostgreSQL host or a reviewed event-driven worker
may be needed; reducing polling blindly can expire the 10-minute recovery queue.

[Supabase pricing](https://supabase.com/pricing) currently documents a database-only Free
option (500 MB, shared CPU/500 MB RAM, 2 active projects, 5 GB egress, inactivity pause
after a week and no automatic backups). This is an additional candidate, not an enrolled or
tested replacement: verify empty-schema provisioning, custom roles, connection pooling,
verified TLS, region, actual limits and independent backups before selecting it. Its default
mail service is still not the app's production email adapter.

Official adapter references:
https://docs.netlify.com/build/configure-builds/monorepos/,
https://docs.netlify.com/build/functions/scheduled-functions/,
https://docs.netlify.com/build/functions/configuration/ and
https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/.

## Cost categories - no invented prices/free guarantees

Local development needs existing hardware/electricity/disk/network. Future costs may include domain/DNS, app compute, managed database/storage, backups, logs/error monitoring, transactional email/SMS, payment-provider/settlement fees, applicable taxes, and professional legal/security review. Exact current pricing and free-tier eligibility/retention/public traffic limits must be checked at selection time. No promise that a public financial product can operate indefinitely for free.

## Production operational requirements

- Define SLOs, alert recipient and incident severity. Use random correlation IDs; redact names, messages, session/guest tokens, payment details and provider secrets. Do not upload customer data to analytics/error tools by default.
- Database backups encrypted and access-controlled, with defined retention, region, RPO/RTO and scheduled isolated restore tests. The local demo drill is not this program.
- Migrations versioned and tested on a production-like restore. Prefer expand/contract; keep last compatible app artifact; financial-ledger corrections are forward append-only events, not destructive migration rollback.
- On deploy: run migration preflight, read-only smoke tests, synthetic flow, auth/tenant isolation, health/error checks, then controlled enablement. Roll back application only while DB compatibility holds; otherwise follow the reviewed recovery plan.
- Pause new payment initiation during provider incidents, never fake failure/success. Preserve/reconcile late events; queue durable processing with replay IDs and deduplication.
- Queue notifications via transactional outbox with retry/backoff and a unique business-effect key. Failure to deliver a message cannot reverse a payment.
- Incident response: disable new collection, preserve minimal evidence, rotate compromised credentials, restrict support access, reconcile affected events, assess legal notification duties, communicate accurately and audit recovery.

## Release checklist - all unchecked items block the corresponding release

- [ ] User decides release target, stack, payment model and funding policy.
- [ ] Maintained authentication, recovery, session lifecycle and abuse protection implemented/tested.
- [ ] Guest contribution, private status and owner dashboard flows implemented/tested.
- [ ] Provider eligibility/settlement route approved in writing for model B, or direct-UPI owner setup/manual-confirmation rules for A.
- [ ] INR amount/idempotency/concurrency/ledger/refund/dispute/reconciliation acceptance tests pass for the selected mode.
- [ ] Immutable recipient snapshots and sensitive-change reauthentication/audit.
- [ ] Legal/privacy/terms/support notices reviewed; deletion/export/retention defined.
- [ ] Admin/support least privilege, abuse reporting/moderation and suspension/recovery.
- [ ] Export formula-injection defense, goal changes/history, safe image pipeline if enabled.
- [ ] Mobile real-device/slow-network/accessibility/browser acceptance and security review.
- [ ] Reviewed production runtime/dependencies, TLS/Secure cookies/CSP/secrets, durable rate limits.
- [ ] Backup restore, migration/rollback and incident rehearsal; redacted monitoring.
- [ ] Explicit external action/audience/cost approvals, then verified deployment.

## Official-source review log (checked 2026-11-18)

- Next.js official installation docs: https://nextjs.org/docs/app/getting-started/installation — verified Windows support, Node minimum and build/lint command guidance. Exact dependency versions also queried through npm.
- Node SQLite docs: https://nodejs.org/api/sqlite.html — explicitly marked release candidate, not claimed stable for production.
- MeitY official DPDP Rules 2025 index surfaced by official-domain web search: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025 — index lists rules, corrigendum and enforcement timeline. A separate generic MeitY page returned 403. Read the actual current rules/commencement notifications with counsel before applying obligations.
- Government PIB summary surfaced by official-domain search: https://pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=1&reg=3 — mentions phased implementation. This summary is not a determination that every provision is in force for this app.
- Income Tax Department page retrieved: https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1 — general return guidance only, **not evidence of marriage-gift exemption or this app's tax treatment**.
- An attempted RBI URL returned unrelated bank-cessation material and was rejected as evidence. Current applicable payment-aggregator directions/provider obligations remain **unverified and a launch blocker**.

Qualified review questions: relevant DPDP provisions and commencement dates; controller/fiduciary/processor roles; notice/consent/children's access; erasure vs statutory retention; incident reporting; data transfers/processor locations; platform payment-aggregation classification; whether wedding cash gifting and multiple recipient couples are permitted; actual recipient KYC; settlement/refund/chargeback obligations; gift recipient/timing and tax treatment; platform fees/GST/invoicing; consumer grievance/support obligations. No investment, lending, charitable-fundraising, return or tax-benefit claims.
