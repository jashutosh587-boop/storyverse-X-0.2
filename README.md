# Storyverse X

**Import anime catalog:** see [docs/IMPORT-ANIME.md](docs/IMPORT-ANIME.md) for the Windows guided importer.

A catalog of anime, film, TV, books, novels and manga that links related titles together and lets members keep a personal library.

This repository is **a working foundation and one complete vertical slice** of the much larger "Storyverse X" specification, not the whole specification. What exists is real and tested. What does not exist is listed plainly in [docs/STATUS.md](docs/STATUS.md), which sorts every module of the specification into *implemented and tested*, *implemented but untested*, *blocked by credentials* and *planned*. Read that file before deciding what this is worth to you.

## What you can do with it today

- Browse anime, movies, TV, books, novels and manga, each with its own page, filters (genre, minimum score), sorting and paging.
- Search every category at once, with suggestions as you type, tolerance for typos and alternative titles.
- Open a title: provider details, the provider's score (labelled with its source), the members' own average and rating distribution, connected titles (sequels, adaptations, spin-offs), similar titles by shared genres and themes, credits, and the sources with their credit lines.
- Create an account, sign in and out (email and password, email confirmation supported, a forgotten password reset by emailed link), and keep a library: status, progress (checked against the title's real length), a 1 to 10 rating, private notes, and a per-entry "private" switch.
- Have a public profile, or make it private; export all of your data (email address, profile and library) as JSON; delete your account and everything attached to it.
- Import titles from public providers with a command-line tool that is safe to re-run (see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)).
- On anime pages, show curated official streaming destinations and play authorized HTTPS MP4/HLS episodes; signed-in members can resume from their private saved watch progress. Set up the limited, role-protected watch manager using [docs/STREAMING.md](docs/STREAMING.md).

Nothing on the site is invented. If the database is empty the pages say so, and if the site is not connected to a database it shows a setup screen that lists what is missing.

## What it is not (yet)

No AI assistant, no personalised recommendations, no discovery lab, no interactive knowledge graph, no reviews beyond a single 1 to 10 rating, no social features beyond profiles, no analytics, no general-purpose admin console or CMS, and no subscriptions. The watch manager is deliberately limited to curated provider links and rights-confirmed episode sources. 11 of the specification's 27 pages exist. The data has never been imported from the live providers, and the migrations have never been applied to a hosted Supabase project, because the environment this was built in had neither credentials nor network access to them. [docs/STATUS.md](docs/STATUS.md) has the details and the reasons.

## Quick start

You need Node.js 20.9 or newer and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local        # then fill it in, see "Configuration" below
```

1. **Create the database.** In your Supabase project, apply all eight files in `supabase/migrations/` in name order. Either paste each file into the dashboard's SQL editor, one after another, or use the [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase db push` applies the files in `supabase/migrations`; see its documentation for linking a project; I have not run it). Do **not** run `supabase/tests/shim.sql`: it only exists so the tests can run on a plain Postgres.
2. **Configure sign-in.** In the Supabase dashboard (Authentication, URL configuration) set the Site URL to your `SITE_URL` and add `SITE_URL/auth/callback` and `SITE_URL/auth/recovery` to the redirect allow-list. Details and caveats are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
3. **Import some titles.** Start with a dry run that writes nothing:

   ```bash
   npm run ingest -- jikan anime --pages 1 --dry-run
   npm run ingest -- jikan anime --pages 2      # needs DATABASE_URL and INGEST_CONTACT
   ```

4. **Run the site.**

   ```bash
   npm run dev                                   # http://localhost:3000
   ```

Without step 1 and the Supabase variables the site still starts; the pages that need data show a "not set up yet" screen that lists what is missing, instead of data.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload. |
| `npm run build` / `npm start` | Production build and server. |
| `npm run typecheck` | TypeScript in strict mode, no output files. |
| `npm run lint` | ESLint. |
| `npm test` | Unit and database tests (Vitest). No network, no Supabase project needed. |
| `npm run e2e` | Builds the site, then runs the browser tests (Playwright). First time on a new machine: `npx playwright install chromium`. Needs ports 3100, 3101, 54321 and 54322 free. |
| `npm run check` | Typecheck, lint and unit tests together. |
| `npm run ingest -- <provider> <kind> [options]` | Import titles. `npm run ingest -- --help` lists everything. |

## How it is tested, and what that does and does not prove

- **288 unit and database tests.** The real SQL migrations run inside an embedded Postgres 17 (PGlite) and the tests exercise row-level security, search, the library rules, privacy (including that private notes cannot be read from the tables), the SQL functions' contract with the web app's validators, the provider adapters (against hand-written fixtures), the ingestion pipeline, the security helpers, and how failures of the sign-in service are worded (checked against the real auth client).
- **83 browser tests** (71 on a desktop browser, 7 on a phone-sized one, 5 against a second copy of the site that has nothing imported). They drive the *production build* through a real Chromium: sign-up and sign-in, validation, the library journey, privacy, export and deletion, email confirmation, password reset, token renewal, signing out on one device only, outage behaviour, the site as its owner first sees it, security headers and cookies, automated WCAG 2.2 A/AA checks with axe on 32 page states, keyboard focus, and layout at 320 px and 200 % text.
- **What the browser tests talk to is a stand-in for Supabase** (`e2e/mock-supabase`): it runs the real migrations but is not Supabase. It proves the web app's wiring and the database rules; it does not prove that a hosted Supabase project behaves identically. The first thing to do with real credentials is to run through sign-up, sign-in, the library and a deletion by hand and then run the checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- The test catalog ("E2E Test Anime 001" and so on) is generated. It never leaves the `tests/` and `e2e/` folders, and the site's own code never imports from them.
- Automated accessibility checks find only part of the real problems. Nobody has tried the site with a screen reader.

More in [docs/TESTING.md](docs/TESTING.md).

## Configuration

Copy `.env.example` to `.env.local`. Never commit `.env.local`; `.gitignore` already excludes it.

| Variable | Needed by | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | web app | Your project's API URL. |
| `SUPABASE_ANON_KEY` | web app | The project's *anon* key. Safe for a server to hold; it can only do what row-level security allows. There is deliberately no `NEXT_PUBLIC_` prefix: the browser never talks to Supabase. |
| `SITE_URL` | web app | The site's public address without a trailing slash. Used for the links in confirmation and password-reset emails, the sitemap and canonical URLs. |
| `DATABASE_URL` | `npm run ingest` only | Direct Postgres connection. It can write every table: keep it out of the web app's environment and out of the browser. |
| `DATABASE_SSL_CA`, `DATABASE_SSL_INSECURE` | `npm run ingest` | Optional TLS settings for that connection. |
| `INGEST_CONTACT` | `npm run ingest` | An email address or URL providers can reach you at; sent in the `User-Agent`. |
| `TMDB_READ_ACCESS_TOKEN` | `npm run ingest -- tmdb ...` | TMDB's read access token. Without it the TMDB importer refuses to start; it never pretends. |

## Project layout

```
src/app/            pages, server actions, route handlers (Next.js App Router)
src/components/     interface components
src/lib/api/        typed calls to the database's SQL functions, validated with zod
src/lib/providers/  Jikan, TMDB and Open Library adapters (fetch, validate, normalise)
src/lib/ingest/     idempotent import pipeline used by the CLI
src/lib/supabase/   server-side Supabase clients (no browser access to the database)
src/middleware.ts   per-request CSP nonce and sign-in renewal
supabase/migrations the database: tables, row-level security, SQL functions
supabase/tests      test-only shim so the migrations run on a plain Postgres
scripts/ingest.ts   the import command
tests/              unit and database tests
e2e/                browser tests and the Supabase stand-in
docs/               architecture, status, deployment, data sources, testing
.github/            CI and scheduled-import workflows (never run; see STATUS)
```

## Before this earns any money

Read [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) first. In short: TMDB's free API is for non-commercial projects only and a revenue-generating product needs a commercial licence from TMDB; MyAnimeList's terms for commercial reuse of the data Jikan serves have not been verified (the page that holds them refuses automated readers); Open Library asks not to be used for bulk downloads. There is also no privacy policy or terms of service yet, and no security review by a third party. [docs/STATUS.md](docs/STATUS.md) lists these under "Before launch".

## Connect the database (Supabase)

The application already includes its Supabase integration and eight database migrations. To connect a hosted database:

1. Create a Supabase project and keep its database password private.
2. From this repository root, run `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, then `npx supabase db push` to apply the migrations in `supabase/migrations/`.
3. Copy `.env.example` to `.env.local` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SITE_URL` using the values for your project. Never put the `service_role` key in the app.
4. In Supabase Authentication URL settings, set the Site URL to your site and allow the `/auth/callback` and `/auth/recovery` redirect URLs.
5. Run `npm run dev` and check `http://localhost:3000/api/health`; it should return `{"status":"ok"}` once the migrations are applied and the environment values are correct.

For the full deployment, email, backup, import and security checklist, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The hosted Supabase connection still needs to be created and tested with your own project credentials.

## Documentation

- [docs/STREAMING.md](docs/STREAMING.md) official provider links, authorized MP4/HLS playback, episode publishing, watch-progress privacy and setup.
- [docs/STATUS.md](docs/STATUS.md) the implementation checklist and honest ledger: all 25 modules, all 8 phases, known limits, blockers.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) how it is built and why.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) environments, Supabase setup, hosting, import schedule, monitoring, backup and recovery.
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) providers, terms, attribution, credentials.
- [docs/TESTING.md](docs/TESTING.md) the test layers and how to run them.

No licence has been chosen for this code. Until you add a `LICENSE` file, nobody else has permission to reuse it.

## Supabase connection

For local development, copy `.env.example` to `.env.local` and set:

- `SUPABASE_URL`: your Supabase project URL
- `SUPABASE_ANON_KEY`: your Supabase **publishable** key (`sb_publishable_...`) or legacy anon key
- `SITE_URL`: the public site URL (for local development, `http://localhost:3000`)

For Netlify, add the same variables under **Site configuration → Environment variables**, then trigger a new deploy. Set `SITE_URL` to your deployed site URL. Never add a Supabase secret/service-role key to this app.

### Apply the database schema

The SQL migrations are in `supabase/migrations/`. Apply them to the Supabase project in filename order using the Supabase SQL Editor, or link the project with the Supabase CLI and run `supabase db push`. Do not assume the database is ready until the migrations complete successfully.
