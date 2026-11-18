# Checkpoint 1 - verified local persistence slice

Historical checkpoint. **Current code/results are documented in `current-increment.md`; shared owner entry has been retired and maintained local auth/manual synthetic reporting are implemented.**

## Completed

Actual files are in `C:\Users\hgadarla\projects\wedding-dream-wishlist`. README contains the source tree, exact prerequisites/versions/commands and synthetic seed/reset instructions. Executed SQL is in `migrations\001_demo.sql`; API, ER/state diagrams, requirements-test matrix, design threats, privacy/terms/support drafts, decisions and release operations are in `docs`.

Implemented: responsive owner draft form with up to 20 goals; exact INR targets; SQLite disk persistence; explicit fictional demo session; owner preview; scoped read/state operations; publish/pause/close/archive; private/unlisted/public semantics; anonymous guest page; local link/copy/link-QR/download fallbacks; expiry in IST/UTC; zero confirmed progress; no real-payment UI/routes; generic error/loading/empty/unavailable states.

## Actual final results

- ESLint: passed.
- Strict TypeScript: passed.
- Vitest: **56 tests passed in 4 files**.
- Optimized Next build: passed.
- Playwright: **6/6 passed**, desktop Chromium and Pixel 7 emulation; owner widths 320/390/768/1280.
- Rendered desktop/mobile guest and 320px owner screenshots inspected.
- Seed ran twice and preserved existing data on the second run.
- SQLite backup/isolated restore integrity, foreign-key, marker and row-count checks passed.
- Production dependency advisory check: zero known vulnerabilities at check time.
- No complete accessibility certification, independent completed-code security audit, real-device UPI test or public hosting test.

## Confirmed direction and remaining blockers

User confirmed a **hosted responsive production app**, not a local-only deliverable. PostgreSQL is the hosted open-source database direction. Current executable slice is **still SQLite**: no PostgreSQL runtime installed/running; Docker daemon unavailable. No shared service, paid resource or prerelease database package was started/installed to bypass that limitation.

Pending: approved final backend/runtime and runnable PostgreSQL environment; PostgreSQL migration and integration/restart/restore tests; simulated contributions/private status/idempotency; maintained authentication/verification/recovery and full owner dashboard; choice of A/B payment model; overfunding policy; provider eligibility and settlement/legal/privacy review if B; security/accessibility/operations hardening; external deployment/audience/cost approvals.

Nothing is publicly deployed, published to GitHub or connected to an external account. No real money is accepted, and no emails/SMS/WhatsApp were sent. Test helper servers were bounded test processes; use `npm run dev` to start the local demo yourself.

## Continuation without restarting decisions

Preserve this source and schema. First obtain/enable an explicitly scoped supported local PostgreSQL runtime or approved staging database, then port and validate the same persistence slice without changing payment-model authority. Next implement slice 2's synthetic contribution adapter and truthful independent demo totals; never reinterpret simulated gifts as owner/provider-verified money. Slice 3 replaces fictional entry with maintained authentication before any real-user exposure. Actual money remains disabled until D01/D04 and the applicable approval gates are resolved.
