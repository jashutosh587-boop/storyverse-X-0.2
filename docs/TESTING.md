# Testing

There are two layers. Both run without any outside service, so they run the same on a laptop and in CI. Neither talks to a real Supabase project or to the real data providers; section 4 says what that means.

## 1. Unit and database tests (`npm test`)

Vitest, in `tests/`. 288 tests in 23 files at the last full run, about 45 seconds.

The important ones run the **real SQL migrations** inside PGlite (Postgres 17 compiled to WebAssembly, with `pg_trgm`). Supabase supplies things a plain Postgres lacks (the `auth` schema, the `anon` and `authenticated` roles, `auth.uid()`), so `supabase/tests/shim.sql` stands in for them. The shim is test-only and must never be applied to a real project.

| File | What it checks |
| --- | --- |
| `db/schema.test.ts` | The migrations apply cleanly in order; row-level security is on for every table; every `SECURITY DEFINER` function pins its `search_path`; the catalog is readable by anyone and not writable by visitors; the ingestion tables are hidden from them; invalid values are rejected by the database; the duplicate-title report works. |
| `db/search.test.ts` | Prefix and typo-tolerant search, alternative titles, synopsis weighting, filters, every sort order, weighted score ranking, paging limits, odd characters in the query, suggestions (two or more characters), facets, similar titles across media, stubs hidden. |
| `db/library.test.ts` | Library rules: default status, start and completion dates, progress against a title's real length, completion filling progress, ratings 1 to 10, notes (including the 2,000-character limit, and notes leaving with their entry), removal, listing with counts, paging in a fixed order through entries that share a timestamp, the community aggregate (private entries count, never individually exposed), relations seen from both sides. |
| `db/privacy.test.ts` | Who can read what: public and private profiles, owner-only notes (queried straight from the tables as a visitor and as another member, not only through the functions), private entries hidden from others, a private profile hiding the whole library, writes to someone else's entries or notes refused, anonymous writes refused, protected profile columns (including `avatar_url`), a sign-up that still gets a profile when its username is taken at the last moment, export of only the caller's data, deletion cascade. |
| `db/site.test.ts` | Catalog statistics, attributions, account deletion. |
| `db/contract.test.ts` | Calls every database function the web app calls through the app's own wrappers, as a signed-out visitor and as two members, and checks the answers pass the app's zod schemas. This is the test that found the signed-out profile bug. |
| `providers/*.test.ts` | The three adapters against hand-written fixtures (shape changes, bad items, missing credentials), and the HTTP client's rate limiting, retry and backoff with a fake clock. |
| `ingest/*.test.ts` | Idempotent upserts, `unchanged` detection, relations and stub lifecycle, runs and error logging, resume, the command line parser and `.env` loading. |
| `lib/*.test.ts` | The small security and formatting helpers: CSP builder, open-redirect guard, safe external URLs, image host allow-list, browse parameter parsing, environment validation, error mapping, health endpoint. |
| `lib/auth-errors.test.ts` | How each failure of the sign-in service is worded for each form (sign in, sign up, ask for a reset link, choose a new password), including the errors the **real** auth client produces from real HTTP answers (a server that is not there, a 500, a gateway's HTML page, rate limits), so the wording does not depend on a guess about their shape. |

The provider fixtures (`tests/fixtures/providers.ts`) are **written by hand from the providers' documented shapes**, not captured from live responses. If a provider's real output differs, these tests will not notice; a live dry run (`npm run ingest -- <provider> <kind> --dry-run`) will, because every item is validated.

## 2. Browser tests (`npm run e2e`)

Playwright with Chromium, in `e2e/`. 83 tests in three projects (71 desktop, 7 phone, 5 on the empty site), about 8 minutes with the build: `desktop` (a desktop-sized browser), `mobile` (a Pixel 7 profile; the smoke and layout specs only) and `first-run` (`first-run.spec.ts` only, against a site with an empty catalog). They run against the **production build** (`next build`, then `next start`), so they test what would ship: the main site on port 3100 with its stand-in on 54321, and a second copy on port 3101 with a stand-in on 54322 that has no titles. One worker, because all tests share one database.

First run on a new machine: `npx playwright install chromium`.

| Spec | What it checks |
| --- | --- |
| `smoke.spec.ts` | Home page content, security headers and a fresh nonce on every page, helpful 404s, protected pages sending visitors to sign in and back, and a crawl of every link reachable from the home page (none dead). |
| `catalog.spec.ts` | Browsing, filters, sorting, paging, empty categories (also inside search), artwork that fails to load (placeholder instead of a broken image, in the grid and on a title page), search and suggestions (keyboard and mouse), title pages, connected stories, similar titles, sources and the TMDB credit. |
| `account.spec.ts` | Sign-up validation, taken usernames and emails, sign-in and out (signing out ends this browser's session and leaves another device signed in), open-redirect attempts, the full library journey, privacy between two accounts, profile editing and paging, data export (email address included), account deletion, email confirmation (including opening the link in a different browser), and session renewal with refresh-token rotation. |
| `password.spec.ts` | Password reset end to end: asking for a link from the sign-in page and from Settings, the same answer for an address with an account, one without, and one the sending limit applies to, a clear message when the email cannot be sent, a link opened in the wrong browser or a second time, checks on the new password (length, match, same as current), the old password stopping working, and an unconfirmed account being confirmed by its reset link. |
| `first-run.spec.ts` | The `first-run` project: against a site with nothing imported, the home page, every category, search and the title-free parts of the site (suggestions, health, sitemap, sources, a missing title) say plainly that the catalog is empty and what to do, invent nothing, and a first member can sign up, see an empty library and sign out. |
| `security.spec.ts` | Cookie flags, no secrets in anything the site ships, hostile input shown as text, the Content-Security-Policy, odd URLs, methods, caching rules, robots and sitemap, and what visitors see during a database outage and during a sign-in outage. |
| `a11y.spec.ts` | axe-core for WCAG 2.0, 2.1 and 2.2 level A and AA on 32 page states, the skip link, a visible focus ring on every tab stop, layout at 320 px, and text at 200 %. |
| `layout.spec.ts` | No sideways scrolling on any page at the project's phone and desktop sizes. |

Guards that apply to every browser test (`e2e/support/test.ts`): the browser may only talk to the site itself (a request to any other origin, including the Supabase stand-in, fails the test), and any console error, uncaught exception or failed request fails the test unless the test says it expects one.

### The Supabase stand-in (`e2e/mock-supabase`)

Test code that answers the two Supabase services the site uses, so the site can be exercised without a project:

- the REST function-call endpoint (`/rest/v1/rpc/<function>`) runs the **real** SQL functions in PGlite, switching to the database role named in the caller's token;
- a small part of the auth service: sign-up, password, refresh-token and PKCE sign-in, current user, password change, sign-out with its three scopes (`global`, the default; `local`; `others`; each sign-in is its own session), the confirmation link, and the password-reset request and link (which, like the real service, answers 200 for an unknown address, applies a sending limit only to addresses that have an account, and confirms an unconfirmed account when its reset link is opened). Refresh tokens are single use, as in Supabase, and a sign-in that has been ended is refused even while its access token has not expired (403 `session_not_found`). The reset, password-change, sign-out and ended-session behaviour was written from the auth service's published source (`auth.go`, `recover.go`, `verify.go`, `user.go`, `logout.go`), not observed on a running service;
- test controls (`/__test/config`, `/__test/emails`, `/__test/stats`) to simulate outages, require email confirmation, shorten token life, set a minimum gap between reset emails, read the "sent" emails, and count refresh grants.

It is seeded through the real normalisers from hand-written fixtures plus 40 generated filler titles ("E2E Test Anime 001" and so on); started with `MOCK_SUPABASE_EMPTY=1` it skips the seed, which is the second copy the `first-run` project uses. Screenshots taken with `SCREENSHOTS=1 npx playwright test` show this generated catalog, not real data.

## 3. Running parts of it

```bash
npx vitest run tests/db                      # a folder
npx vitest run tests/db/contract.test.ts     # a file
npx vitest                                   # watch mode

npm run build
npx playwright test e2e/account.spec.ts      # one spec
npx playwright test -g "privacy"             # by name
SCREENSHOTS=1 npx playwright test e2e/layout.spec.ts   # pictures in e2e/.artifacts/screens
npx playwright show-report                   # the HTML report of the last run
```

## 4. What these tests do not prove

- **The hosted Supabase services.** The stand-in is a faithful enough copy of the parts the site uses to catch wiring mistakes, but it is not Supabase. Differences in email delivery and limits, the refresh-token reuse window, cookie and redirect handling, error codes and messages, Postgres version and extension defaults can only be found against a real project. The checklist in [DEPLOYMENT.md](DEPLOYMENT.md) section 9 is the first step.
- **The live providers.** Never contacted. Fixtures are hand-written.
- **Concurrency.** The database is one connection, so races (two imports at once, two tabs saving the same entry) are not exercised.
- **Scale.** The test catalog has about 50 titles. Search speed and index use at hundreds of thousands or millions of rows is untested, and so is load of any kind.
- **Other browsers and devices.** Only Chromium, at two screen sizes. Not Safari or Firefox, not real phones.
- **Other Node.js versions.** Everything was run on Node.js 22 (the CI file also uses 22). The declared minimum, 20.9, has not been tried.
- **Assistive technology.** Automated checks catch a fraction of real accessibility problems. Nobody has used the site with a screen reader, a voice control tool or a switch device.
- **Visual quality.** Screenshots were reviewed by eye during the build. There is no visual regression testing.
- **Security.** The tests check the defences described in [ARCHITECTURE.md](ARCHITECTURE.md). They are not a penetration test, and nothing here replaces an independent review.
- **The CI workflows.** `.github/workflows/*.yml` pass `actionlint` (a static checker) and have never run.

## 5. Habits that keep the tests honest

- A bug found by a test is fixed, and the fix is checked by putting the bug back and watching the test fail. Done for the signed-out profile defect and the health endpoint in the first review, and in the second review for each fix listed in [STATUS.md](STATUS.md) section 7 as proven that way: the breakage was put into a copy of the code, the named tests failed, and the code was restored byte for byte. Two of those checks found tests that could not tell the difference (a sign-out test that passed with the fix removed, because the stand-in accepted a signed-out device's token; a heading check that ignored letter case), and both were strengthened before the fix was counted as covered.
- Tests that count community ratings use their own titles, because all tests share one database.
- Authenticated checks inside a browser test use in-page `fetch`, because Playwright's request client does not send `Secure` cookies over HTTP.
- Tests that expect the browser to log an error clear the `problems` list on purpose, so an unexpected error still fails everything else.
