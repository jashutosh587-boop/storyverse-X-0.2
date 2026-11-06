# Deployment

How to get Storyverse X running on real services, and how to keep it running.

**Read this first.** Nothing in this guide has been exercised against a real Supabase project, a real host, or the real data providers. The build environment had no credentials for them and could not reach them. The steps below are written from the code and from Supabase's own documentation (pages named where they were read), and each section says what is verified and what is not. Treat your first deployment as the first real test, and use the checklist in section 9.

## 1. What runs where

| Part | What it is | Needs | Holds |
| --- | --- | --- | --- |
| Web app | A Next.js 15 server (`npm run build`, `npm start`) | Node.js 20.9 or newer, outbound HTTPS to your Supabase project and to the three image hosts | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` |
| Database and sign-in | A Supabase project (Postgres, Auth, REST) | the eight migrations applied | the data |
| Import job | `npm run ingest`, run on a schedule or by hand | Node.js, a Postgres connection, outbound HTTPS to the providers | `DATABASE_URL`, `INGEST_CONTACT`, optionally `TMDB_READ_ACCESS_TOKEN` |

The web app and the import job are separate on purpose: the job's `DATABASE_URL` can write every table, so it must never be present in the web app's environment, in the browser, or in the repository.

## 2. Environments: development, staging, production

Use one Supabase project per environment. They are cheap to create, and sharing one is how test data ends up in production.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Supabase project | your own (free plan is fine) | its own | its own |
| `SITE_URL` | `http://localhost:3000` | the staging address | the production address |
| Sign-in confirmation email | optional | on | on |
| Imported data | a few pages of one provider | a realistic sample | the real import |
| Who has `DATABASE_URL` | you | the import job | the import job |

Promote a database change by applying the same migration files, in order, to the next environment. Migrations are forward-only: there are no "down" scripts. Never edit a migration that has been applied anywhere; add a new one. To undo a change, write a migration that undoes it.

Status: this arrangement is a recommendation, not something that has been set up or tested.

## 3. Create the database

1. Create a Supabase project. Keep the database password in a password manager.
2. Apply the eight versioned migrations in `supabase/migrations/` in filename order. Recommended (CLI): from the project root, use the [Supabase CLI](https://supabase.com/docs/guides/cli), then run:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   The repository includes `supabase/config.toml`; `db push` applies the versioned files in `supabase/migrations/`. Alternatively, in the dashboard SQL Editor, run each migration file in filename order, one at a time, and confirm each finishes successfully before continuing.
3. Do **not** apply `supabase/tests/shim.sql`; it exists only so the test suite can run on a plain Postgres.
4. In the project's API settings, copy the project URL and the **anon** key into `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Do not use the `service_role` key anywhere: nothing in this project needs it, and it bypasses row-level security.

Status: the migrations run cleanly on Postgres 17 (PGlite) with a shim that stands in for Supabase's `auth` schema and roles. They have **not** been run on a hosted Supabase project. If one fails there, the likely cause is a difference between the shim and the real `auth` schema; report it as a bug in the migration and fix it with a new migration.

## 4. Configure sign-in

All of this is in the Supabase dashboard (Authentication). The sessions and redirect pages named below were read for this guide; anything not attributed to them is not verified.

- **Site URL and redirect allow-list.** Set the Site URL to your `SITE_URL`. Add `SITE_URL/auth/callback` and `SITE_URL/auth/recovery` (for example `https://example.com/auth/callback` and `https://example.com/auth/recovery`) to the redirect URLs allow-list; the first receives the link in the confirmation email, the second the link in the password-reset email. Supabase's redirect-URL guide says the Site URL is the default redirect when none is given and is critical for email confirmations and password resets, and that the allow-list supports wildcards. It does not say what happens to a redirect that is not on the list, so add the exact address and test it. Add your staging address to the staging project the same way; for preview deployments, add their pattern to the allow-list of the project they use.
- **Confirm email.** Turn it on for staging and production. The site supports it: a new member is sent a link, the link comes back to `/auth/callback` with a code, and the site exchanges it for a session. The link only works in the browser that started the sign-up (it uses PKCE); in any other browser the member is sent to the sign-in page, where their password works once the account is confirmed. These links expire after a time set in the project (check the value; I did not verify the default). A member whose link has expired chooses “Forgot your password?” on the sign-in page: the reset link confirms the address as well (read from the auth service's source, `recoverVerify`; not tried on a live project), and there is no separate “resend” button. If you edit the confirmation email template, keep the link pointing at the redirect, not only the Site URL: the redirect guide says that when a redirect is given you may need `{{ .RedirectTo }}` instead of `{{ .SiteURL }}` in the template. Test a real sign-up after any template change.
- **Email delivery.** Supabase's built-in sender has limits that I did not verify. For production, configure your own SMTP provider and check the current limits in the dashboard before launch. Until then, sign-ups beyond the limit will not receive their email.
- **JWT expiry and refresh tokens.** Leave the defaults. Per Supabase's sessions guide, the access token lasts 1 hour by default, values below 5 minutes are discouraged, refresh tokens can be used once, and the reuse interval defaults to 10 seconds ("we do not recommend changing this value"). This site renews sessions in its middleware and was tested with a token life as short as 92 seconds up to the 1 hour default; do not set it lower than about 2 minutes.
- **Passwords.** The site requires 8 to 72 characters. Set the project's own password strength rules as you see fit; when the auth server rejects a password as too weak the site says "Choose a stronger password." It always shows its own fixed messages, never the auth server's text.
- **Password reset.** “Forgot your password?” on the sign-in page (also reachable from Settings) asks for an address and always answers “If an account exists for that address, we sent a link”, so it cannot be used to find out who has an account. The link in the email goes through the auth server to `SITE_URL/auth/recovery?code=…`, which signs the member in and sends them to `/reset-password` to choose a new password. Keep `{{ .ConfirmationURL }}` in the Reset Password email template. Like the confirmation link, it works only in the browser that asked for it, and only once; a link that cannot be used sends the member back to the request form with an explanation. If you turn on the project's options that require a recent sign-in or the current password when a password is changed, a reset link is not affected (it is a fresh session, and the auth server's source exempts recovery sessions from the current-password rule), but a member who is already signed in and opens `/reset-password` directly is told to use a fresh reset link. Not tried on a live project.
- **Not built:** changing the email address, a “current password” step when changing a password from Settings (today a change starts from an emailed link), social sign-in, two-factor.

## 5. Host the web app

The app is an ordinary Next.js server, so any host that runs Node.js 20.9 or newer works. Not tried on any host.

1. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SITE_URL` in the host's environment (not `DATABASE_URL`).
2. `npm ci && npm run build`, then `npm start` (port 3000 by default; `-p` changes it).
3. **Serve it over HTTPS.** In production the session cookies are `Secure`, so a browser will not send them back over plain HTTP and nobody could stay signed in. (Chromium makes an exception for `localhost` and `127.0.0.1`, which is how the browser tests run a production build over HTTP. The cookie flag follows `NODE_ENV`, not the actual protocol, so a production build tried over plain HTTP at any other address will not keep sessions.)
4. If a proxy terminates TLS, make it send `X-Forwarded-Proto: https`; the Content-Security-Policy adds `upgrade-insecure-requests` only for HTTPS requests.
5. The site must be able to reach `cdn.myanimelist.net`, `image.tmdb.org` and `covers.openlibrary.org` (its image optimizer fetches artwork from them).
6. Point your uptime monitor at `GET /api/health`: 200 `{"status":"ok"}` when the database answers, 503 `{"status":"unavailable"}` or `{"status":"not_configured"}` otherwise, never cached, never explaining why.

Things that behave in ways worth knowing:

- Every page is rendered per request and reads the session, so nothing is served from a page cache. Each request that carries a session cookie makes one call to Supabase Auth in the middleware and one more to validate the user. Plan for that in your Supabase quota. The shared "suggestions" endpoint is the exception: it is cacheable for a short time.
- If the environment variables are missing, the site still starts and shows a setup screen on the pages that need data; `/api/health` returns 503.
- There is no rate limiting on sign-in, sign-up, search or suggestions beyond what Supabase applies to its own auth endpoints. Put a rate limiting layer (your host's, a CDN's) in front before opening the site to the public.

## 6. Import the catalog (the background job)

Run the first import by hand, from a machine you control.

```bash
export DATABASE_URL='postgresql://postgres:...@...'   # see "Which connection string"
export INGEST_CONTACT='you@example.com'                # a real address or URL, sent to the providers

npm run ingest -- jikan anime --pages 1 --dry-run      # fetch and check, write nothing
npm run ingest -- jikan anime --pages 2                # a real, small import
```

Then open the site, check the counts on the home page, open a title and read its source line, and look at the run log in the SQL editor:

```sql
select provider, job, status, items_seen, items_inserted, items_updated, items_failed, started_at
  from public.ingestion_runs order by started_at desc limit 10;
select * from public.ingestion_errors order by id desc limit 20;
```

Other commands: `jikan manga`, `tmdb movie`, `tmdb tv` (needs `TMDB_READ_ACCESS_TOKEN`), `openlibrary books --subject "science fiction"`; options `--relations` (stores connections between titles; one extra request per title for Jikan), `--order popular|score|newest`, `--resume` (continue a failed run), `--start-page N`. Run `npm run ingest -- --help` for the full list. Exit status: 0 succeeded, 2 finished with some failed items, 1 failed.

Speed: the importer keeps at least 1.1 seconds between Jikan requests, so a page of 25 titles takes about 1 to 2 seconds, and about 30 seconds with `--relations`. Importing tens of thousands of anime titles would take many hours, and it is polite to spread such a job over days. Open Library asks not to be used for bulk downloads; see [DATA-SOURCES.md](DATA-SOURCES.md).

**Which connection string.** Per Supabase's connection guide, the direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only unless the project has the paid IPv4 add-on; the shared pooler in session mode (port 5432) works over IPv4 on every plan; transaction mode (port 6543) does not support prepared statements. The importer opens ordinary transactions and works with a direct or session-mode connection. If your machine or CI runner is IPv4-only, use the session-mode pooler string from the dashboard. (As far as I know GitHub-hosted runners have no IPv6 access, so the scheduled workflow needs the pooler string; I did not verify that.) Transaction mode has not been tried. For TLS, the importer verifies the server certificate; if verification fails, give it Supabase's CA certificate in `DATABASE_SSL_CA` (a path to a PEM file) rather than switching verification off with `DATABASE_SSL_INSECURE=1`.

**Scheduling.** `.github/workflows/ingest.yml` runs the importer on a schedule or by hand using GitHub Actions secrets (`DATABASE_URL`, `INGEST_CONTACT`, optionally `TMDB_READ_ACCESS_TOKEN`). It has never run: nothing could be pushed to GitHub from the build environment. Read it, set the secrets, run it manually once with `dry_run` on, and only then enable the schedule. A failing run sends GitHub's normal failure notification, which is the only alerting that exists. Any scheduler that can run a Node command (cron on a small server, for example) works the same way.

Two imports of the same job at once are guarded by a lock per provider record, which has only been tested on a single connection. Avoid overlapping runs anyway; the workflow uses a concurrency group for that.

## 7. Monitoring

What exists:

- `/api/health` for uptime checks (section 5).
- The server writes one line to its standard output for each database call that fails (`[rpc] <function> failed: <code> <message>`) and for each response that did not match what the site expects (`returned an unexpected shape`). Those lines contain database error text, so keep the logs private. Send them to your host's log search and alert on the pattern `\[rpc\]`.
- `ingestion_runs` and `ingestion_errors` in the database (section 6).
- Supabase's dashboard for database load, size, and auth activity.

What does not exist: error tracking (Sentry or similar), tracing, dashboards, alert rules, log shipping, synthetic sign-in checks. Add them before relying on the site. A good first set of alerts: health check failing for 2 minutes; any run in `ingestion_runs` with status `failed`; database size above 80 % of the plan's limit; Supabase email quota nearly used.

## 8. Backup and recovery

Facts below come from Supabase's backups page (read for this guide); the procedures are mine and have not been rehearsed.

**What Supabase provides.** Daily backups for Pro, Team and Enterprise projects: 7 days of history on Pro, 14 on Team, up to 30 on Enterprise. Free-plan projects do not get them, and Supabase's advice is to export regularly with the CLI's `db dump`. Point-in-time recovery (to the second) is a paid add-on for Pro and above, needs at least a Small compute add-on, and replaces the daily backups while it is on. Restoring is done from the dashboard (or the management API for point-in-time recovery); the project is unavailable while it restores, for longer the bigger the database is. Database backups do **not** include files in Supabase Storage (this project does not use Storage).

**What matters in this project.** The catalog can be rebuilt by running the importer again (it is idempotent), so it is the cheap part to lose. What cannot be rebuilt is members' data: the `auth.users` rows (accounts), `public.profiles` and `public.library_entries`.

**Recommended routine** (adapt to your plan):

1. Production on Pro or above, with daily backups on. Decide whether to buy point-in-time recovery based on how much library data a member could lose in a day.
2. In addition, take a logical backup of the member data on a schedule you control, for example weekly, and keep it somewhere other than Supabase. A starting point with the direct or session-mode connection string (not rehearsed; check the result opens):

   ```bash
   pg_dump "$DATABASE_URL" --format=custom --data-only \
     --schema=auth --schema=public \
     --file="storyverse-members-$(date +%F).dump"
   ```

   Treat the file as personal data: encrypt it, restrict access, and delete old copies.
3. Free-plan projects: do step 2 daily, since there is nothing else.

**Recovery drill (do this before launch, not after an accident).** Create a throwaway Supabase project, apply the migrations, restore a backup into it (or restore the dashboard backup to a new project), set the web app's variables to point at it, and check: an existing account can sign in; its library entries are present; privacy still holds (a private entry is invisible to another account); `/api/health` is ok. Write down how long it took. Until a drill has been done, assume recovery does not work.

**Undoing a bad import.** Imports insert and update titles (and replace a title's alternative names, credits and connections with the provider's current ones); they never delete an imported title, only the hidden placeholder titles that a dropped connection leaves behind. A bad run can be corrected by importing again. To remove a provider's titles entirely, delete from `titles` where the source matches, in the SQL editor, after taking a backup.

## 9. Before the first real visitor

Tick each one on staging, then on production.

- [ ] Migrations applied, in order, without errors.
- [ ] Sign-up with a real email address: the confirmation email arrives (and its link returns to the site signed in), a wrong password is refused, sign-out works.
- [ ] Password reset with a real email address: “Forgot your password?” sends the email, its link (opened in the same browser) lands on “Choose a new password”, the new password works and the old one does not, and the same link does nothing the second time. Ask for a link for an address with no account and check that the page says exactly the same thing. Signed in on two browsers, sign out of one: the other stays signed in.
- [ ] Add a title to the library, reload, change it, remove it. Add a private entry, then look at the profile from a signed-out browser: it must not be there. Make the profile private: a signed-out browser must get "not found".
- [ ] Export your data, then delete the account; the average rating of a title you rated changes accordingly.
- [ ] `/api/health` returns ok; stop the database connection (or use a wrong anon key on a copy) and see 503.
- [ ] A dry-run import and a small real import succeed; the About page lists the sources and their credit lines.
- [ ] `SITE_URL` is correct: the sitemap (`/sitemap.xml`) and canonical links use it.
- [ ] HTTPS everywhere; the browser shows a session cookie flagged `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] No `service_role` key, no `DATABASE_URL`, and no `.env*` file in the web host's environment, build output or repository.
- [ ] A rate limiting layer is in front of the site.
- [ ] A restore drill has been done and timed (section 8).
- [ ] Data licences are settled for what you display and how you earn (see [DATA-SOURCES.md](DATA-SOURCES.md)).
- [ ] A privacy policy and terms of service exist and are linked. They do not yet.
