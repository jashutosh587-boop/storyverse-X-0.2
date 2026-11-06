# Deploy Storyverse X on Vercel

This folder is the application root. It contains `package.json` and `package-lock.json` directly at the top level. When uploading to GitHub, copy the **contents of this folder** into the repository root; do not put this whole folder inside another folder.

## GitHub Desktop upload

1. Extract the ZIP.
2. Open the extracted folder and confirm that `package.json`, `package-lock.json`, `src/`, `supabase/`, and `.github/` are visible immediately.
3. In GitHub Desktop, open your `storyverse-x` repository and choose **Repository → Show in Explorer**.
4. Copy all files and folders from the extracted project root into the repository folder. Keep the repository's hidden `.git` folder. Do not copy `.env.local`, `node_modules`, or any secret keys.
5. Commit the changes and push to `main`.
6. On GitHub, confirm `package.json` and `package-lock.json` appear at the repository's top level.

## Vercel settings

- Framework preset: Next.js
- Root directory: `./`
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: leave the default
- Node.js version: 22 (also recorded in `.nvmrc`)

Set these environment variables for Production (and Preview if desired):

- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_ANON_KEY` = your Supabase publishable key (`sb_publishable_...`)
- `SITE_URL` = your deployed Vercel URL, without a trailing slash

The first two values can be set before the first deployment. Once Vercel gives you the deployment URL, set `SITE_URL` to that exact URL and redeploy.

Never put `DATABASE_URL`, your database password, or a Supabase service-role key into the website's environment variables.

## Supabase streaming migration

The streaming migration is included in both locations:

- `supabase/migrations/20261106000100_streaming_watch.sql`
- `STREAMING_MIGRATION.sql` (a convenient copy for Supabase SQL Editor)

Apply the streaming migration once in the existing Supabase project. Do not rerun `supabase/SETUP_ALL.sql` on a database that is already set up. The existing anime catalogue rows are not part of this migration and should remain intact.

## Important playback note

The player accepts authorized video sources that you own or are licensed to distribute. Use official provider link-outs for services that do not permit embedded playback or use DRM. Catalogue metadata alone does not provide playable episode streams.
