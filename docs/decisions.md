# Decisions and assumptions - checkpoint 1

## Authority

No authorization exists to publish a repository, host publicly, create accounts, accept terms, purchase domains, enable billing, use paid credits, send communications, onboard recipients or move money. No such action was performed. Public package/docs downloads and local code/testing were used. No workplace source or data was read into this project.

## Open decisions

| ID | Decision | Recommendation | Status / gate |
|---|---|---|---|
| D01 | A: couple-controlled UPI vs B: provider checkout | User requested direct payment, guest submission and no gateway dependency | A is the chosen direction; synthetic report/confirmation implementation only, real money still disabled |
| D02 | Demo, real pilot or launch-ready target | Publicly hosted responsive consumer application, developed through local verified slices | User clarified hosted/production target; external deployment still requires separate approval |
| D03 | Stack | Next.js/TypeScript with separately operated PostgreSQL on durable storage for hosted target; Spring decision remains open | User requested free/open-source durable database; current verified slice still SQLite. Java absent; Docker daemon unavailable. No untested PostgreSQL migration claimed |
| D04 | Hard cap vs overfunding | Allow overfunding with truthful totals; simpler than reservations/late success | Undecided; no contributions yet |
| D05 | Maintained authentication provider/library | Self-hosted Better Auth, MIT, stable 1.7.21 | Implemented/tested locally with private terminal-only mail adapter; no hosted auth dependency; real delivery remains blocked |
| D06 | Fees, tax treatment, gross/net progress | Explicit disclosure and provider-specific review | No fees or real financial semantics invented |
| D07 | Provider and settlement model | Written wedding-gifting/multiple-couple eligibility required | No provider selected |

Essential decisions were grouped into one form; the user was unavailable to answer. Temporary technical choices do not approve a business payment model.

## Temporary implemented choices

The user explicitly clarified that the final app will be hosted and requested a secure, free/open-source database with crash resilience. **The local SQLite slice is not the final hosted database architecture.** PostgreSQL is the planned hosted datastore, operated independently of application processes. Application restarts, database crashes and complete infrastructure loss require different controls. Durable volumes, WAL/crash recovery, off-instance backups, tested restoration and possibly paid/redundant infrastructure must be planned separately. Open-source licensing does not make hosting or high availability free.

- Single fictional owner, entered explicitly through a local-only demo endpoint; no signup/recovery impersonating production auth.
- Synthetic data only. Separate SQLite files for demo/E2E. No cloud DB or external API calls at app runtime.
- Default visibility is unlisted, all pages noindex. Public means anonymous access with potential future discoverability; no public directory exists now. Unlisted has no discovery commitment and is not strong authentication. Private means owner preview only.
- Local application URL uses `127.0.0.1`. Link QR encodes only the guest page URL. Phone handoff is intentionally unsupported until an approved reachable environment exists.
- INR targets have configurable-in-code safe bounds (1 to 1,000,000,000 paise), maximum 20 goals. Contribution limits remain a separate future decision.
- Names/story become public content after an explicit publication action for public/unlisted visibility. Guest identity and exact gift amount public display is off; no such data collected in slice 1.
- Slugs, targets and goal content cannot be edited after creation in this slice. Goal reorder/archive and target-change history will be introduced with rules/tests, not ad hoc updates.
- Paused/closed wishlists retain guest-readable display content; archived wishlists disappear anonymously. No reopening closed wishlists or state rollback to draft.
- Co-owners and admin registration disabled. No universal admin password. No support money-adjustment UI.
- No uploads/remote images, third-party analytics/fonts, service worker, notification service or external account provisioning.
- UI strings partly centralized; full localization extraction deferred. No WCAG conformance claim.

## Real-money activation gate - future server design

An immutable per-wishlist payment-mode record must distinguish DEMO, DIRECT_UPI and PROVIDER. A demo never turns into a live wishlist by toggling a browser flag. Create a separately reviewed live wishlist/migration, preserving immutable historical snapshots if any records exist.

Provider activation requires documented eligibility, owner authorization, server-held secure credentials, reviewed legal/tax/privacy/support notices, authenticated recipient onboarding, reconciliation/refund/dispute policies and passing release tests. Direct UPI activation requires authenticated owner setup and recipient confirmation, reauthentication on change, audited immutable recipient snapshots and truthful manual-confirmation language. Neither gate exists as a live activation route now; the database accepts only `demo` and refuses payment-mode updates.
