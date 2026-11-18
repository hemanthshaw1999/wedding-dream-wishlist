# Actual verification - checkpoint 1

Historical checkpoint-1 evidence. **Current authentication/reporting results and audit limitations are in `current-increment.md`; this file's old zero-advisory result does not cover the new dependency set.**

Updated incrementally during execution. Do not interpret a planned test as passed.

| Check | Actual result |
|---|---|
| Runtime probe | Node 26.13.0, npm 11.20.0; SQLite 3.54.0 in-memory create/query passed |
| Subscription | Not inspectable; M365 entitlement not inferred |
| Java / container runtime | Java not on PATH; Docker executable present but daemon untested/not started |
| Dependency install | npm generated package-lock.json; install completed; peer override warnings emitted |
| ESLint | Passed after moving JSX out of try/catch |
| TypeScript | Passed with strict/noEmit |
| Unit/integration | Final completed run: 4 files, 56 tests passed, including refusal to modify unrelated databases |
| Production build | Compiled and all routes built successfully |
| Production advisory audit | `npm audit --omit=dev --audit-level=low`: found 0 vulnerabilities at execution time |
| Seed/persistence | First seed created fictional example; second seed detected existing data without changes |
| SQLite backup/restore | SQLite backup API + isolated restore copy passed integrity, foreign-key and row-count checks |
| Initial E2E | API checks passed; browser checks initially blocked by missing Chromium |
| Browser prerequisite | Pinned Playwright Chromium installed in project-local ignored data folder |
| Subsequent E2E | Revealed streamed not-found HTTP status and ambiguous test alert locator; fixes applied |
| Final desktop/mobile E2E | Final rebuilt app: 6/6 passed in 14.1s, desktop Chromium and Pixel 7 Chromium emulation, including owner widths 320/390/768/1280 |
| Rendered screenshot inspection | Desktop/mobile guest and 320px owner screenshots inspected: readable layout, INR grouping, wrapped Unicode/story, stacked controls and no horizontal overflow in tested viewport |
| PostgreSQL runtime probe | No psql/postgres/pg_ctl on PATH; Docker client/Compose exist but Docker daemon pipe unavailable. No service started or PostgreSQL migration claimed |
| Full WCAG 2.2 AA / real screen reader | Not run; no compliance claim |
| Real payments / real auth / public launch | Not implemented, not executed, not authorized |

Known test discovery: a root loading boundary caused Next to stream a 200 before the guest page's not-found outcome. The loading boundary was moved to the owner subtree so unavailable guest pages can return a proper 404. The alert test now selects the application's error rather than also matching Next's route announcer. Both fixes passed the final rebuilt browser run.

The browser run covers draft->published guest access, link/QR generation, escaped malicious text, isolated guest access denial, session cookie flags, origin/host checks, simultaneous duplicate creations and state changes, private-page denial, no-store/noindex, sign-out revocation, validation preservation and keyboard skip-link focus. It does not certify screen-reader operation, every mobile width or real UPI behavior.

The expanded run also tests a missing session during submission, re-entry without losing fields, aborted API request/offline error preservation and owner layout overflow at 320/390/768/1280 CSS pixels. Session unit tests use the actual SQLite query/hash and a mocked cookie accessor to test the exact expiry boundary; they do not claim real customer authentication.
