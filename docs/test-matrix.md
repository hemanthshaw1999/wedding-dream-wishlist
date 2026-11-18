# Requirements-to-tests matrix

Checkpoint-1/full-backlog matrix. **See `current-increment.md` for implemented self-hosted auth, recovery, real HTTP isolation, synthetic reports, private status, confirmation/reversal and CSV test results that supersede DEFERRED rows below.**

Status definitions: **PASS** = actually executed successfully; **PENDING** = test exists but final result not yet recorded; **DEFERRED** = not implemented/tested; **BLOCKED** = requires a decision, provider approval or authorized environment. No coverage percentage or all-edge-cases claim.

| ID | Scenario / requirement | Expected result | Level / test location | Actual status |
|---|---|---|---|---|
| W01 | Create/view and survive restart | Draft, ordered goals and owner relation persist | SQLite integration, store.test.ts | PASS |
| W02 | Public projection | Only approved fields; no owner/session/version | Integration; E2E | PASS |
| W03 | Private, draft, archived, missing wishlist | Same unavailable response; no private data | Integration; HTTP/browser E2E | PASS |
| W04 | Pause/close/archive | Allowed transitions only; readable unavailable paused/closed, archive hidden | Integration | PASS |
| W05 | Expiry IST boundary | UTC exclusive next midnight; exact boundary expired | Unit | PASS |
| W06 | Two tabs state update | One update succeeds; stale version rejected/audited once | Integration + concurrent HTTP E2E | PASS |
| W07 | Simultaneous duplicate creation / slug collision | One row graph; loser 409, transaction rollback | Integration + concurrent HTTP E2E | PASS |
| W08 | Slug changed/stale QR | Slug edits absent; stale unknown link unavailable | Design + missing-link integration | Edit DEFERRED; lookup PASS |
| W09 | Goal edit/reorder/archive, target below confirmed | Explicit history/restrictions; no silent money changes | Future integration | DEFERRED; edit API absent |
| M01 | Valid exact paise and Indian grouping | Exact integer storage and en-IN formatting | Unit | PASS |
| M02 | Invalid/zero/negative/excess decimal/exponent/overflow/over-limit target | Reject server-side | Unit + DB integration | PASS |
| M03 | Currency/owner/payment-mode override | Reject unknown fields and DB-mode changes | Unit + DB integration | PASS |
| M04 | Contributions: min/max/mismatch | Reject independently of UI; do not confuse target limits | Future contribution unit/integration | DEFERRED |
| M05 | Two final gifts, overfunding and late success | Enforce selected policy; never promise cross-system atomic cap | Future concurrency tests | BLOCKED D04 |
| M06 | Simultaneous gifts, tabs, retry after timeout | One contribution/effect per idempotency scope | Future API/ledger tests | DEFERRED |
| M07 | Attempt vs contribution / truthful progress | No attempt double-counting; pending never confirmed | Slice-1 projection + future ledger | Zero-progress PASS; ledger DEFERRED |
| A01 | Forged paid click/screenshot/reference | No bank-verified claim; owner manual review only | Future direct-UPI tests | BLOCKED D01; no such endpoint now |
| A02 | Duplicate reference / abandoned app / delayed bank update | Review signal; stays unconfirmed | Future direct-UPI tests | BLOCKED D01 |
| A03 | Wrong recipient/goal / recipient changed during payment | Immutable snapshot mismatch warning, reauth for change | Future direct-UPI tests | BLOCKED D01 |
| A04 | Owner misconfirmation/reversal | Append correction; exact net amount; no fake platform refund | Future ledger tests | DEFERRED |
| B01 | Fake success URL/client callback | Cannot mark receipt | Future provider tests | BLOCKED D01/provider |
| B02 | Invalid signature/replay/duplicate/out-of-order webhook | Reject invalid; durable unique receipt; idempotent effects | Future provider integration | BLOCKED provider approval/spec |
| B03 | Crash after receipt before acknowledgement | Retry safe, no missing/duplicate effect | Future fault-injection | DEFERRED |
| B04 | Delayed success after timeout/failure screen | Reconcile authoritative status; preserve attempt history | Future integration/E2E | DEFERRED |
| B05 | Amount/order/currency/recipient mismatch | Quarantine/review; no confirmed progress | Future provider integration | DEFERRED |
| B06 | Refund twice / partial / failed refund | Serialize reservation; cap net refunded; failure not completion | Future ledger concurrency | DEFERRED |
| B07 | Dispute after payout / settlement or payout failure | Separate statuses, eligible progress adjusted, incident workflow | Future reconciliation tests | DEFERRED |
| B08 | Reconciliation mismatch/provider outage | Durable pending state, retry/backoff, audited repair | Future fault-injection | DEFERRED |
| B09 | Mode change after contributions | Server rejects; reviewed migration required | DB invariant + future financial tests | Demo mode lock PASS; migration DEFERRED |
| B10 | Goal archive while attempt pending | Resolve original goal snapshot without money loss | Future integration | DEFERRED |
| S01 | Owner A reads/edits Owner B | 404; no side effects | Store integration | PASS; real multi-user HTTP DEFERRED |
| S02 | No/expired session, sign-out | Deny private reads/writes; no data on owner page | sessions.test.ts with persisted real token hash and mocked cookie transport; E2E session removal | PASS for absent/malformed/revoked/exact expiry boundary; form survives missing session |
| S03 | Guest status token enumeration | 256-bit scoped hash, expiry and no cross-guest disclosure | Future integration | DEFERRED; status endpoint absent |
| S04 | Recovery token reuse/expiry, enumeration abuse | Maintained auth; generic responses; single use | Future auth tests | DEFERRED; no real auth |
| S05 | CSRF/rebinding/foreign or null Origin | Reject mutations/unknown Host; JSON required | Unit + HTTP E2E | PASS |
| S06 | XSS | Render tested script payload inertly; no raw HTML | Browser E2E | PASS for tested payload; no claim covering all XSS |
| S07 | SQL injection | Parameterized content stored literally | Integration | PASS |
| S08 | Malicious uploads / SSRF | No surface now; safe decode/re-encode and fetch controls if added | Design; future tests | Absent by design; future DEFERRED |
| S09 | CSV formula injection | Prefix dangerous text after whitespace/control normalization; no raw formulas | Future export tests | DEFERRED; export endpoint absent |
| S10 | Rate-limit abuse / oversized input | Bounded body and durable limits; 429 | Body unit; database-backed rate bucket with controlled clock | PASS for bound/exhaustion/reset/actor separation; distributed abuse DEFERRED |
| S11 | Anonymous guest privacy / scraping | No identity/amount by default; noindex not authorization | Projection tests + review | Projection PASS; scrape resistance not guaranteed |
| S12 | Sensitive logs/caches/previews/QR | No tokens/PII in public response or URLs; no-store/no-referrer | Source design + E2E | Public projection/link/cookie/cache checks PASS; exhaustive log audit DEFERRED |
| S13 | Deletion/export with retained financial cases | Explain retention/holds; separate private records from ledger | Future privacy workflow | DEFERRED |
| S14 | Co-owner revoke / admin privilege | Deliberate membership/revocation, reauth/audit | Future auth/support tests | DEFERRED; features disabled |
| S15 | Backup restore integrity | Snapshot opens, marker/checks/counts match | Executed seed + backup script | PASS |
| S16 | Wrong/unrelated database path | Refuse before migrations; unrelated table/content untouched | SQLite integration | PASS |
| U01 | Empty owner list / no contributions | Useful empty state, truthful zero | Integration + UI | Zero PASS; full empty UI manual DEFERRED |
| U02 | Large wishlist/many contributions | Limits, pagination and no clipping | Goal-limit unit + future load tests | Goal limit PASS; scale DEFERRED |
| U03 | Long/Unicode/emoji/plain malicious text | Bounded safe rendering and no overflow | Unit + browser | PASS for tested inputs/viewports |
| U04 | Unavailable images | No remote images in slice 1; CSS artwork | Design | External-image test not applicable yet |
| U05 | Slow/unstable/offline / timeout / safe retry | Visible errors; in-tab form preserved; unknown payment status honest | Validation + aborted-request E2E | Validation, missing-session re-entry and offline preservation PASS; slow/unknown-payment tests DEFERRED |
| U06 | Mobile UPI unavailable / desktop-to-phone handoff | No fake success; clear unsupported-local QR notice | UI + future real-device tests | Local notice implemented; real-device DEFERRED |
| U07 | Mobile responsiveness | Narrow viewport, no horizontal overflow/clipping | Chromium desktop + Pixel emulation E2E; owner widths 320/390/768/1280 | PASS for checked layouts; physical devices/other browsers DEFERRED |
| U08 | Keyboard/focus/screen reader/reduced motion/contrast | Labelled inputs, skip link, status announcements; manual AA review | Keyboard E2E + future manual audit | Skip link/focus PASS; comprehensive keyboard/screen-reader/AA DEFERRED |
| U09 | Notifications fail/retry/deduplicate | Outbox retry never reverses payment | Future worker integration | DEFERRED; no notifications sent |

Additional uncovered risks: shared-machine access, browser extensions, current inline CSP allowances, disk exhaustion, unpaginated lists, full transitive dependency review, migration concurrency across processes, Safari/Firefox differences, backup encryption/rotation, incident response timing and real payment model/legal suitability. See `threat-model.md`.
