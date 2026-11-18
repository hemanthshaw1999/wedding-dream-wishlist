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
