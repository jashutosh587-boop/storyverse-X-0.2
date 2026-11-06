# Status

State of the project on **4 November 2026** (version 0.1.1), after a second review of the first delivery. This is the implementation checklist and status ledger the specification asked for: every module and phase, sorted into its four labels, with the evidence and the limits. Section 7 lists what the second review found and fixed.

## 1. How to read it

The four labels come from the specification:

- **Implemented and tested.** The code exists and automated tests that pass exercise it. "Tested" here means tested against the **test database** (the real migrations running in an embedded Postgres), the **Supabase stand-in** used by the browser tests, and **hand-written provider fixtures**. See [TESTING.md](TESTING.md).
- **Implemented but untested.** The code exists, but nothing automated establishes that it works, or the one thing that matters (the live service) was never reached.
- **Blocked by credentials.** It needs a key, account or licence that was not available.
- **Planned.** Not built. Nothing in the product pretends otherwise.

Two facts qualify every "implemented and tested" below, and are repeated where they matter:

1. **No hosted Supabase project was used.** The migrations ran on Postgres 17 (PGlite) with a shim for Supabase's `auth` schema and roles, and the site's browser tests ran against a stand-in for the Supabase services. A hosted project may behave differently.
2. **No data provider was contacted.** The environment had no credentials for TMDB and no network route to the providers. Everything about importing was tested on fixtures written by hand from the providers' documented shapes.

**Production readiness is not claimed.** The specification says not to claim it until security, reliability and operations have been verified. They have not: see sections 5 and 6.

## 2. Where the project stands

| Phase | Name | State |
| --- | --- | --- |
| 1 | Foundation | Done for what was in scope (architecture, database, sign-in, design system, navigation, three provider adapters), with the two facts above. |
| 2 | Global catalog | Partly. Pipeline and three adapters built and tested on fixtures; novels, comics, characters, people and schedules not built; live import never run. |
| 3 | Discovery | Partly. Search, filters, sorting, rankings as sort order and rail, title pages, a list of connected titles. No Discover page, rankings page or interactive graph. |
| 4 | Personalization | Partly. Profiles, a personal library with progress and ratings, privacy, export, deletion. No collections, reviews or analytics. |
| 5 | Intelligence | Not started, except a non-personalised "similar titles" match. |
| 6 | Community | Not started, except public or private profiles. |
| 7 | Administration | Not started, except the import command's run log and a duplicate report. |
| 8 | Production | Partly. Security and accessibility tests, deployment docs, health check, CI files that have never run. Not production-ready. |

Pages: **11 of the 27** required pages exist (section 4).

## 3. The 25 modules

Where a label has nothing, it is left out.

### Module 1. The Global Content Universe
- **Implemented and tested:** one catalog for anime, movie, TV, book, novel and manga (the schema also allows `comic`); alternative and translated titles; per-title sources with credit text; credits (studios, producers and similar) stored and shown; a browsing page per category with genre, status, year, minimum score, sort and paging; home page rails.
- **Implemented but untested:** importing anime and manga from Jikan and books from Open Library (fixtures only; never run live). Jikan's light novels map to the novel type, so the Novels page fills only through that path.
- **Blocked by credentials:** movies and TV (TMDB token; a commercial licence if the product earns money).
- **Planned:** a source for novels beyond Jikan's light novels, comics and webtoons beyond what Jikan labels manga, characters, voice actors, soundtracks, airing schedules, seasonal and upcoming browsing, episode databases, franchises as entities, regional cinema browsing, documentaries and short films as categories.

### Module 2. The Master Knowledge Graph
- **Implemented and tested:** typed, directed connections between titles with an inverse for each, imported from Jikan (`--relations`); a "Connected stories" section that shows them from both sides; hidden placeholder titles for connections to titles not yet imported; "similar titles" across media by shared genres and themes.
- **Planned:** people, characters, studios and franchises as nodes and pages; the interactive network view (zoom, filtering, node search, expanding); multi-hop queries; stored relationship types beyond what providers supply ("same universe", "shares themes").

### Module 3. Story AI (multi-agent)
- **Planned.** Nothing built. No AI feature exists in the product, so there are no AI answers to be fake. It will need an LLM provider account (blocked by credentials when started).

### Module 4. Recommendation engine
- **Implemented and tested:** "similar titles" by shared genres and themes. It is a content match, labelled as such, and is not personalised.
- **Planned:** everything else: taste model, collaborative filtering, matrix factorisation, embeddings and vector retrieval (needs `pgvector`, which the test database lacks), graph recommendations, feedback, experiments.

### Module 5. Discovery Lab 2.0
- **Planned.** The category pages' filters are ordinary browsing, not the Lab.

### Module 6. Advanced global search
- **Implemented and tested:** one search across all categories; suggestions as you type (keyboard and mouse); typo tolerance (trigram similarity); matching on alternative and translated titles; synopsis matching at lower weight; filters (category, genre, status, year range, minimum score), sorts, facets; safe handling of odd characters; filter controls that stay filled in with the criteria in use, and a "Clear filters" action.
- **Planned:** search by contributor, character, franchise; natural-language and semantic search (the specification's example query cannot be answered); Boolean operators; search history; trending searches; language-aware matching beyond the simple and English configurations.
- **Unknown:** speed at scale. It has been run on a catalog of about 50 titles.

### Module 7. Entertainment social network
- **Implemented and tested:** profiles, public or private, with a privacy switch; per-entry privacy.
- **Planned:** following, feeds, messaging, communities and clubs, publishing (articles, lists, polls, challenges), moderation (reports, block, mute, spoiler protection).

### Module 8. Reviews and intelligence
- **Implemented and tested:** one 1 to 10 rating per member per title; the community average, count and distribution, with private entries counted but never named; provider score and member score kept separate and labelled.
- **Planned:** multi-dimension ratings, written reviews, helpfulness, rating trends, critical reviews, sentiment summaries (needs an LLM). Protection against rating manipulation is limited to one rating per member; there is nothing else (no account-age rules, no anomaly detection).

### Module 9. Personal media management
- **Implemented and tested:** status (planned, in progress, completed, paused, dropped, repeating) with labels that fit the medium; progress in episodes, chapters or pages, checked against the title's real length; completion filling progress; start and completion dates stamped by the database; 1 to 10 rating; private notes (kept in a table only their owner can read); per-entry privacy; your own library page with status filters; export of all your data (email address, profile, library) as JSON; account deletion.
- **Planned:** seasons, volumes, reading and watching time; custom lists; private, public and collaborative collections; tags; editable dates; import from other services' list formats; CSV export. (The start and completion dates are stored but not shown anywhere yet.)

### Module 10. Personal analytics
- **Planned.** The data to compute from exists (library entries); no dashboard, report, CSV or PDF export.

### Module 11. Live data and release intelligence
- **Planned.** Titles carry the status and dates their provider supplied; there are no schedules, alerts or calendars.

### Module 12. Collection ecosystem
- **Planned.**

### Module 13. Comparison engine
- **Planned.**

### Module 14. Achievements and gamification
- **Planned.**

### Module 15. Administrator command center
- **Implemented and tested (command line only):** every import is logged with counts and a resume point, failures are recorded per item, a report lists likely duplicate titles for a human to review.
- **Planned:** the console itself, roles, user management, moderation, business analytics, a security center.

### Module 16. Editorial and publishing CMS
- **Planned.**

### Module 17. Premium subscription architecture
- **Planned.** Needs a payment provider (blocked by credentials when started) and, before it earns money, licences for the data it shows (see [DATA-SOURCES.md](DATA-SOURCES.md)).

### Module 18. Technical architecture
- **Implemented and tested:** a modular monolith: Next.js 15 (App Router), React 19, strict TypeScript, Tailwind 4, Supabase (Postgres, Auth), relational graph modelling, Postgres search. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Planned:** the AI layer, a separate search or vector service if Postgres is outgrown, queues and workers beyond the command line, caching, containers.

### Module 19. Data ingestion and ETL
- **Implemented and tested (on fixtures and the test database):** validation of every provider response; normalisation to one shape; idempotent upserts keyed on the provider's id with change detection; provenance and credit text; alternative names, credits and relations; per-provider rate limits and retry with backoff; run log, error log, resume and dry run; clear exit codes.
- **Implemented but untested:** every live run; behaviour under two simultaneous imports (the lock exists but the test database has one connection); the scheduled workflow (`.github/workflows/ingest.yml`, never run).
- **Blocked by credentials:** TMDB.
- **Planned:** bulk imports from providers' data dumps, merging duplicates across providers (a work in two providers becomes two titles; the report only flags same-name, same-year pairs), data quality dashboards, more providers.

### Module 20. Security, privacy and trust
- **Implemented and tested:** row-level security on every table with least-privilege grants; function-only data access; per-request nonce Content-Security-Policy and the standard hardening headers; `httpOnly`, `SameSite=Lax`, `Secure` (in production) session cookies; open-redirect guard; no account enumeration on sign-in or when asking for a password-reset link; password reset by emailed one-time link (against the stand-in); sign-out that ends this browser's session only; failures of the sign-in service worded by one module and never reported as a wrong password; hostile input shown as text; no secrets in shipped code; error messages that never leak internals; data export and account deletion. See [ARCHITECTURE.md](ARCHITECTURE.md) section 5.
- **Implemented but untested:** every email the site depends on (confirmation and password reset): delivery, templates, expiry and limits have never been seen on a real project.
- **Planned:** email change; a "current password" step when changing a password from Settings (today a change starts from an emailed link); a separate "resend confirmation" button (a member whose link expired uses "Forgot your password?", whose link also confirms the address, per the auth service's source); reserved usernames (nothing stops a member taking `admin` or `support`); social sign-in, two-factor, rate limiting of sign-in, sign-up and search, CAPTCHA, audit logs, abuse reporting, a privacy policy and terms of service, an independent security review.

### Module 21. Performance and scale
- **Implemented but untested:** indexes for browsing, score, popularity, genres, themes, full-text and trigram search; page size capped at 100; short-lived shared caching of suggestions; per-request caching of the signed-in user.
- **Planned:** load tests, query plans at scale, caching of public pages and of the home page statistics (computed on every home page view), a CDN, a sitemap that lists titles (it lists only the fixed pages), read replicas.
- **Unknown:** whether any of it holds at "millions of catalog records". It has not been tried above about 50.

### Module 22. Testing and quality engineering
- **Implemented and tested:** see [TESTING.md](TESTING.md). The specification's ten-step user journey is covered for register, search, open a title, add it to a collection (the library), update progress and rate (6 of 10 steps).
- **Planned:** the other four steps (select preferences, receive recommendations, join a discussion, view analytics) because those features do not exist; load tests; visual regression; Safari and Firefox; real devices; screen readers; a run against a hosted Supabase project.

### Module 23. Premium user interface
- **Implemented and tested:** a dark, cinematic theme with violet for member data and blue for outside-provider data, a serif display face with a sans body, large poster artwork, one data visualisation (the rating distribution); responsive layout checked at 320 px and at 200 % text; empty and failure states; keyboard focus and a skip link; 32 page states pass axe at WCAG 2.2 A and AA. 11 of 27 pages.
- **Planned:** the other 16 pages, the interactive graph, further data visualisation, motion design, loading states (pages are rendered on the server and show nothing until ready; there are no skeletons).

### Module 24. Installation and deployment
| Deliverable | State |
| --- | --- |
| Complete source code | Delivered (this repository). |
| Organised folder structure | Delivered ([README.md](../README.md)). |
| Database migrations | Delivered, eight files; includes the streaming/watch migration and database test coverage. A hosted project must apply and verify its own migrations. |
| Environment variable template | Delivered (`.env.example`). |
| API integration instructions | Delivered ([DATA-SOURCES.md](DATA-SOURCES.md)); never exercised live. |
| Authentication configuration | Documented ([DEPLOYMENT.md](DEPLOYMENT.md) section 4); never applied to a real project. |
| Seed scripts | There is no demo seed, by design (the rules forbid invented content). The import command is the seeding mechanism. The browser tests' seed is test-only. |
| Background worker configuration | `.github/workflows/ingest.yml`: implemented but untested (passes `actionlint`, never run). |
| Test suite | Delivered and passing (section 7). |
| Docker support | **Planned.** Not provided. |
| CI/CD pipeline | `.github/workflows/ci.yml`: implemented but untested (passes `actionlint`, never run). No deployment step: there is no CD. Dependabot configuration: untested. |
| Deployment guide | Delivered ([DEPLOYMENT.md](DEPLOYMENT.md)); nothing in it has been done on a real host. |
| Monitoring setup | Partly: a health endpoint, log lines and the import log. No error tracking, dashboards or alert rules ([DEPLOYMENT.md](DEPLOYMENT.md) section 7). |
| Backup and recovery documentation | Delivered ([DEPLOYMENT.md](DEPLOYMENT.md) section 8). **No restore has ever been performed.** |
| Complete README | Delivered. |
| Development, staging, production | Documented as three Supabase projects and three sets of variables; not set up. |
| Never commit secrets | `.gitignore` excludes `.env*` except the template; a browser test searches everything the site ships for key material. There is no git history here to check. |

### Module 25. Strict development rules
| Rule | How it is met, and where it falls short |
| --- | --- |
| 1. No static mockup | Every page reads from the database and every form writes to it. |
| 2. No fake functionality | Planned modules are absent, not drawn. |
| 3. No hardcoded arrays as the permanent database | The site has none. The only hand-written data is in `tests/` and `e2e/`, which the site's code never imports. |
| 4. No invented content or ratings | Titles come only from providers; ratings only from providers or members. Empty states say "nobody has rated this yet" and "no data has been imported yet". |
| 5. No exposed credentials | Only the anon key, held server-side. A browser test scans the shipped code. |
| 6. No disconnected buttons / 7. No dead navigation | A browser test crawls every link reachable from the home page and fails on any dead one. Pages in the specification that do not exist are not linked. |
| 8. No fake AI answers | There is no AI feature. |
| 9. Don't pretend an API is connected | An unconfigured site shows a setup screen; the TMDB importer refuses to start without a token; sources show the real provider. |
| 10. Error handling | Database failures, sign-in outages, invalid input and unexpected shapes all have tested, non-leaking handling. An image that fails to load is replaced by the same placeholder a title without artwork gets (browser-tested). Gaps: nothing retries a failed image; the server's own image errors are not reported anywhere. |
| 11. Database security | Row-level security, least privilege, tests for who can read and write what. Not reviewed by anyone independent. |
| 12. Maintainability | Small modules, strict types, validation at every boundary, a test for each layer. |
| 13. Don't mark incomplete integrations completed | This document. |
| 14. Document missing credentials and dependencies | [DATA-SOURCES.md](DATA-SOURCES.md), last section. |

## 4. The 27 pages

| # | Page | State |
| --- | --- | --- |
| 1 | Home | Built and tested. |
| 2 | Discover | Planned. |
| 3 to 8 | Anime, Movies, TV, Books, Novels, Manga | Built and tested. Movies and TV are empty until TMDB is connected; Novels fills only with Jikan's light novels. |
| 9 | Search results | Built and tested. |
| 10 | AI assistant | Planned. |
| 11 | Discovery Lab | Planned. |
| 12 | Knowledge Graph | Planned. (Title pages list connected titles.) |
| 13 | Rankings | Planned. (Sort by score and a "Highest rated" row exist.) |
| 14 to 15 | Community, Clubs | Planned. |
| 16 | Title details | Built and tested. |
| 17 to 19 | Author, Director, Character details | Planned. (Credits are shown on title pages but are not links.) |
| 20 | Personal profile | Built and tested. |
| 21 | Collections | Planned. (Your library page is a single list with status filters.) |
| 22 | Activity feed | Planned. |
| 23 | Analytics | Planned. |
| 24 | Notifications | Planned. |
| 25 | Settings | Built and tested (profile, privacy, a link to change the password by email, export, deletion). |
| 26 | Admin center | Planned. |
| 27 | Editorial CMS | Planned. |

Also built, not on the list: sign-in, sign-up, the two password-reset pages (ask for a link, choose a new password), your library, the data sources page, and the error and not-found pages.

## 5. Known limits and open risks

Each is something to know before relying on the code.

**Verified nowhere but in tests**
- Hosted Supabase behaviour: email delivery and its limits, the refresh-token reuse window, redirect handling, error codes. The stand-in rotates refresh tokens strictly and the tests pass with it.
- The live providers: response shapes (fixtures are hand-written), rate limits (Jikan's could not be confirmed), cover URL behaviour.
- The advisory lock that stops two overlapping imports from duplicating a title was only run on one connection.
- A confirmation or password-reset email's link works only in the browser that asked for it (PKCE), and once; in another browser the member is sent to sign in (confirmation) or back to the request form (reset), with an explanation.
- Password reset and "opening a reset link confirms an unconfirmed address": written from the auth service's published source and reproduced by the stand-in; never seen on a real project. Email delivery, templates, link expiry and sending limits are unknown until then.

**Behaviour you might not expect**
- A site with no environment variables answers 200 with a setup screen; a naive uptime check would call it healthy. Use `/api/health`.
- The session cookie's `Secure` flag follows `NODE_ENV`, not the real protocol, so production must be served over HTTPS.
- Every page request from a signed-in member makes up to two calls to Supabase Auth (middleware and page). This is a cost and a latency to plan for.
- Access tokens shorter than about 90 seconds are an unsupported regime (the client then tries to refresh on every call); tested from 92 seconds up.
- A title with a score but no vote count ranks as 6.5 in "highest rated".
- A work that two providers both list becomes two titles.
- Next.js checks the `Origin` of server-action requests; the site relies on that and does not test it separately.
- Signing out ends this browser's session only. There is no "sign out everywhere".
- Usernames are not screened: a member can take `admin`, `support` or the name of a well-known person.
- Asking for a reset link for an address with no account looks exactly like asking for one that has: the page always says "if an account exists". Only the inbox tells the member which it was. How long the page takes to answer may still differ (sending an email takes longer than not sending one), and the site does not mask that.
- The home page statistics are computed on every request.
- A rating lives on the library entry: removing a title from your library removes your rating, and the community average changes with it.
- The sitemap lists only the fixed pages, not titles.

**Not built, and a real member would meet it**
- No email change, and no "current password" step on a password change (it starts from an emailed link instead).
- No rate limiting anywhere on the site itself.
- No privacy policy or terms of service.
- No loading states.

**Testing gaps**
- Chromium only. No screen reader testing. No load testing. No visual regression. No penetration test.

**Dependencies.** `npm audit` on 3 November 2026 reported 20 vulnerabilities (16 moderate, 2 high, 2 critical); run again on 4 November 2026 it reported the same. Nothing was upgraded, because every fix is a major version change that needs its own test pass.
- *In the production tree (3):* `next` (moderate) and `postcss` (high) because Next 15.5.28 bundles a PostCSS version with advisories about processing untrusted CSS, which the site never does (it compiles only its own stylesheet at build time); `zod` (high), an advisory that GitHub lists as unreviewed and that describes a memory problem in Zod 4's array handling when given very large arrays of failing items. This project uses Zod 3.25.76. npm flags it because the advisory has no lower version bound; I did not verify that 3.x is unaffected. Visitor-controlled lists are capped at 12 entries before validation, and database and provider responses are bounded by page size.
- *Development tools only (17):* `tinypool` (critical: a prototype-pollution gadget in the options passed to its worker pool), `vitest` and `@vitest/mocker` (critical and moderate: file read and code injection through mock redirects and registration), and the ESLint chain (`minimatch`, moderate: a denial of service on crafted glob patterns). I did not analyse exploitability beyond noting that the project runs the tests as a one-shot command, exposes no Vitest server, and passes no outside input to any of these.
- Dependabot is configured to propose updates; the CI audit job reports production findings without blocking.

## 6. Before launch

Required before any real visitor, in the order I would do them. Details in [DEPLOYMENT.md](DEPLOYMENT.md) section 9.

1. Create the Supabase project, apply the migrations, run the sign-up, library, privacy, export and deletion checklist by hand.
2. Do a dry-run and then a small real import. Fix whatever the live providers show that the fixtures did not.
3. Try the confirmation and password-reset emails on the real project (custom SMTP, templates, expiry), and decide about email change and a current-password step.
4. Settle data licensing for what you display and how you earn. Do this **before** charging anything ([DATA-SOURCES.md](DATA-SOURCES.md)).
5. Write a privacy policy and terms of service and link them.
6. Put rate limiting in front of the site.
7. Rehearse a backup restore and time it.
8. Add error tracking and alerts.
9. Commission or perform a proper security review.
10. Plan the major dependency upgrades (Next 16, Zod 4, Vitest) with tests as the safety net.

## 7. Evidence

Last full run, 4 November 2026, on version 0.1.1:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 288 tests in 23 files, all passing |
| `npm run build` | succeeds; every page route is dynamic (only the generated icon is static) |
| `npm run e2e` | 83 tests (71 desktop, 7 phone, 5 on a site with nothing imported), all passing |
| `npm audit` | 20 findings, see section 5 |
| `actionlint` on the workflows | clean; the workflows are unchanged since the first delivery and have never run on GitHub |

### What the second review found

Twelve defects, all fixed. Each is described by what a person would have met. **Proven** means the fix was taken out of a copy of the code, the tests named for it failed, and the code was restored byte for byte ([TESTING.md](TESTING.md) section 5). A fix not marked proven is covered by tests that pass with it, but nobody has checked that they would fail without it.

1. **A member's private notes sat in a table column that anyone could query.** Row-level security chooses rows and cannot hide one column, so a note on an entry of a public profile was readable straight from the table (for example with the project's public key). Only the site's own functions kept it back. Notes now live in a table only their owner can touch (migration 7). Proven: loosening the row rule, or giving visitors access to the table, fails the tests that query it as a visitor and as another member.
2. **Two people choosing the same username at the same moment made the second sign-up fail.** The new member now gets a generated name (`user_` and twelve characters) and can change it in Settings. Proven.
3. **Members could write their own avatar address,** though nothing in the site sets or checks one. The right is withdrawn. Proven.
4. **Paging through a library could repeat or skip entries saved at the same instant.** Listings now have a total order. Proven.
5. **Sign-in told a member their password was wrong when the sign-in service could not be reached.** A network failure carries no HTTP status, which a plain status check misses. The forms now say the service is unavailable. Checked against the real auth client (a closed port, a 500, a gateway's HTML page), not only against hand-made errors. Proven.
6. **A forgotten password had no way back, and a confirmation link that had expired left a member unable to sign in.** Added: ask for a reset link, choose a new password; a reset link also confirms an unconfirmed address. A request is answered the same way for every address, including when the per-address sending limit applies, because the service applies that limit only to real accounts and a different answer would reveal them. Proven for that answer and for the new-password page being reachable only through a reset link. The rest of the journey (wrong browser, used link, outage, checks on the new password, the old password stopping) is browser-tested but not proven this way. Never seen on a real project.
7. **Signing out ended the member's sessions on every device** (the auth library's default). It now ends this browser's only. Proven, but only after the test stand-in was changed to refuse an ended session's unexpired token the way the real service does; before that, the test passed with the fix removed.
8. **The data export left out the account's email address.** Added. Proven.
9. **A profile page past the last page showed an empty list.** It now goes to the last page. Proven.
10. **Search said "No titles match" on a site with nothing imported,** and offered filters and counts for titles that do not exist. Search and each empty category now say the catalog is empty. Proven. A second copy of the site with an empty catalog is now part of the browser tests: home page, every category, search, suggestions, sources, a missing title, and the first member's sign-up, library and sign-out.
11. **Artwork that failed to load showed the browser's broken-image icon.** It falls back to the placeholder a title without artwork gets. Proven.
12. **Sentences that put a category name into running text turned "TV" into "tv"** ("No tv in the catalog yet", "Keep track of this tv series"). Acronyms keep their capitals. Proven in the unit test and in the browser test (after that test was made case-sensitive).

The review also found three weaknesses in the tests themselves: the sign-out test above, heading checks that ignored letter case, and one accessibility test that audited too many pages inside one timeout (now two tests).

### What the first build's own tests found

Evidence that the tests have teeth, from the first delivery:
1. Signed-out visitors got an error page (HTTP 500) on every member profile (`is_self` was null for them). Found by the browser tests, fixed in migration 4, guarded by a contract test that was checked by putting the bug back.
2. The error page's "Try again" re-rendered the cached error instead of reloading data.
3. Search suggestions put links inside list options, which axe reports as nested interactive controls.
4. A long title overflowed the page at 200 % text size.
5. The TMDB credit appeared twice on title pages.
6. A "plan to read" entry in the library said "0 chapters" (found in screenshot review).

## 8. Phase reports

### Phase 1. Foundation
- **Completed:** architecture ([ARCHITECTURE.md](ARCHITECTURE.md)); database core, profiles and library; email and password sign-in with confirmation support and password reset; design system and navigation; adapters for Jikan, TMDB and Open Library.
- **Changed files:** `supabase/migrations/…0100` to `…0300`; `src/app`, `src/components`, `src/lib` (api, supabase, csp, env, format); `src/lib/providers`; `tailwind` styles in `src/app/globals.css`.
- **Database changes:** migrations 1 to 3 (and migration 7, from the second review).
- **Tests executed:** `tests/db/schema`, `tests/providers/*`, `tests/lib/*`.
- **Remaining blockers:** a hosted Supabase project; TMDB token.

### Phase 2. Global catalog
- **Completed:** the import pipeline and command; contributors and credits; alternative names; provenance; run and error logs; duplicate report.
- **Changed files:** `src/lib/ingest`, `src/lib/providers`, `scripts/ingest.ts`.
- **Database changes:** migration 5 (`ingestion_runs`, `ingestion_errors`, `duplicate_title_candidates`).
- **Tests executed:** `tests/ingest/*`, `tests/providers/*`.
- **Remaining blockers:** live runs; TMDB token and licence; sources for novels, comics, characters and people; Jikan terms; Open Library dumps for scale.

### Phase 3. Discovery
- **Completed:** search, suggestions, filters, facets, sorting, rankings as a sort and a rail, category pages, title pages, connected titles, similar titles.
- **Changed files:** `src/app/[category]`, `search`, `title`, `api/suggest`, `src/components/*`, `src/lib/browse-params.ts`.
- **Database changes:** migration 2 (relations, search functions), migration 6 (catalog statistics and attributions).
- **Tests executed:** `tests/db/search`, `tests/lib/browse-params`, `e2e/catalog`.
- **Remaining blockers:** Discover, Rankings and Knowledge Graph pages; semantic search (needs `pgvector` and an embedding source).

### Phase 4. Personalization
- **Completed:** profiles with privacy; library with status, progress, rating, private notes, per-entry privacy; community rating summary; export; account deletion; settings.
- **Changed files:** `src/app/actions`, `src/app/library`, `src/app/u`, `src/app/settings`, `src/components/library-*.tsx`, `profile-forms.tsx`.
- **Database changes:** migration 3 (profiles, library entries, policies), migration 4 (the API functions), migration 6 (`delete_my_account`).
- **Tests executed:** `tests/db/library`, `privacy`, `contract`, `e2e/account`.
- **Remaining blockers:** collections, reviews, analytics are unbuilt; email change; the confirmation and reset emails have not been seen on a real project.

### Phase 5. Intelligence
- **Completed:** none beyond "similar titles".
- **Remaining blockers:** an LLM provider account; `pgvector`; a plan for embeddings.

### Phase 6. Community
- **Completed:** none beyond public profiles.
- **Remaining blockers:** moderation design and tooling must come before any user-generated content.

### Phase 7. Administration
- **Completed:** none beyond the import command's logs and duplicate report.
- **Remaining blockers:** a role model.

### Phase 8. Production
- **Completed:** security tests, accessibility tests, outage tests, health endpoint, deployment, backup and data-source documents, CI and import workflows, Dependabot configuration.
- **Changed files:** `.github/`, `docs/`, `e2e/`, `src/app/api/health`.
- **Tests executed:** the full suite above.
- **Remaining blockers:** everything in section 6.
