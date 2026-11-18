# Threat model and security checklist - local slice

Initial design review and backlog. **See `current-increment.md` for the newly implemented auth/manual-report surfaces and their tests/remaining risks. This is not a completed-code security assessment of the new increment.**

## Review scope and boundaries

A security-review agent reviewed the planned design before coding. It did **not** audit the finished code, conduct penetration tests or find verified code vulnerabilities. Implemented controls below are checked by specific tests where stated. There is no security certification.

Assets: synthetic wishlist content, owner-management capability, session tokens, SQLite integrity and audit history. Actors: anonymous guest, local demo operator, hostile third-party website, malicious text/ID submitter and filesystem administrator. Boundaries: browser -> loopback Next server -> local SQLite; package download supply chain is separate. No runtime external payment/AI/storage service.

Local-only does not protect against a malicious same-user process, browser extension or another person with filesystem/computer access. The environment is shared, not a dedicated security sandbox. Never enter real personal data.

## Implemented controls

- [x] Server launch binds 127.0.0.1; explicit demo gate; exact expected Host.
- [x] Mutations require exact Origin, JSON content type and bounded body. Missing/null/foreign Origin denied.
- [x] Demo entry is conspicuously **not authentication**. No shared/default administrator password. Admin/co-owner features absent.
- [x] High-entropy session cookie; hash stored; HttpOnly, SameSite=Strict, expiry and sign-out.
- [x] Server-side membership-filtered owner queries and immutable caller-controlled owner exclusion.
- [x] Public allowlist projection and private/draft/archive access filters.
- [x] No management token in link/QR. Noindex, no-store, no-referrer.
- [x] React text escaping; bounded fields; no raw HTML, upload or arbitrary remote image fetch.
- [x] Prepared SQL and strict integer-paise constraints, transactions, stable unique slugs and version-conflict handling.
- [x] Database mode locked to demo, no payment routes and no provider credentials.
- [x] Audit append-only triggers; synthetic reset explicitly separate from product behavior.
- [x] Redacted unexpected-error correlation logging; no app analytics or request-body logging.
- [x] Production dependency advisory check executed; zero known findings at the check time (not proof of safety).
- [x] Local snapshot/restore integrity check executed.

## Required before real users

- [ ] Maintained customer authentication, verification/recovery with single-use hashed expiring tokens; enumeration-resistant responses, revocation and abuse protection.
- [ ] Real multi-tenant HTTP isolation testing (current fake account is intentionally shared), sensitive-action reauthentication and least-privilege audited support.
- [ ] Deployment-specific TLS, Secure cookies, session rotation/revocation, distributed rate limits and secrets/key management.
- [ ] Nonce/hash-based CSP. Current Next-compatible inline allowances are a known hardening gap, not an XSS-proof claim.
- [ ] Image decode/re-encode/metadata stripping/private storage if uploads are enabled; SSRF threat review if external fetching is added.
- [ ] Privacy/legal review, retained-financial-case deletion/export rules, moderation/reporting/suspension and abuse workflows.
- [ ] Contribution/financial-ledger invariants, reconciliation, provider signatures/replay handling and refund/dispute tests for the selected payment model.
- [ ] Durable encrypted access-controlled off-site backup, restore timing objectives, incident tabletop and migration/rollback rehearsal.
- [ ] Manual accessibility review, more browsers, slow/offline network testing, dependency/transitive supply-chain review and independent security assessment.

## Explicit uncovered risks

The entire real-payment attack surface is unimplemented and untested. Authentication, public deployment, real recipient onboarding, access revoked for co-owners, malicious uploads, provider outage recovery, recovery-token replay, financial records retention, production support access and communications delivery are likewise unverified.

`noindex` is advisory; a published public/unlisted wishlist can be scraped. Unlisted slugs are not secrets. Public content cannot be reliably recalled from screenshots/copies. Local QR links cannot support phone handoff. SQLite writes are synchronous and not load-tested; owner lists are unpaginated and content can consume disk. Rate limits share the fictional owner/computer and are not an Internet abuse solution.

The seed/reset command and a filesystem administrator can replace data; append-only database triggers are not immutable storage against administrators. Backups contain synthetic plaintext, not encrypted PII storage. A server enabled by a local environment variable is not an approval process for production.
