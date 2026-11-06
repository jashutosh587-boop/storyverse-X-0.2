# Storyverse X · official streaming and episode playback

This feature adds two distinct watch options to anime title pages:

1. **Official provider links** open a rights-holder or streaming service's own title page in a new tab. They are not embedded in Storyverse X.
2. **Built-in episode playback** accepts only HTTPS MP4 or HLS (`.m3u8`) sources that an authorized catalogue admin explicitly confirms are licensed for distribution.

Catalogue metadata imported from public anime databases does **not** include video files or video-streaming rights. The 50 imported title records therefore do not become playable automatically.

## Apply the database migration

For the existing Supabase project, open **Supabase → SQL Editor → New Query**, paste the complete contents of:

`supabase/migrations/20261106000100_streaming_watch.sql`

Run it once. Do not rerun the one-time `supabase/SETUP_ALL.sql` bundle on an already configured project; that bundle is for a fresh setup.

## Authorize the catalogue manager

Sign in to Storyverse X with the account that should manage official links and licensed episodes. In Supabase SQL Editor, run this after replacing the email placeholder with that account's Supabase Auth email:

```sql
insert into public.watch_catalog_admins (user_id)
select id
from auth.users
where lower(email) = lower('YOUR_SUPABASE_LOGIN_EMAIL')
on conflict (user_id) do nothing;
```

Then open `/admin/watch` on the website. Only accounts listed in `watch_catalog_admins` can publish providers or playable episodes. The public anon key cannot write these tables, and no service-role key is needed in Netlify.

## Add official streaming services

In `/admin/watch`, choose the anime, enter the provider name, its official HTTPS title URL, country code (for example `IN`), availability type, and languages. Check the destination belongs to the provider or rights holder and is valid in the selected region before saving it. A provider link is displayed publicly as **Watch on provider**.

## Publish a licensed episode

Host the episode on a video/CDN account you control or are contractually allowed to use. Add its HTTPS stream URL, episode metadata, rights-holder name and optional licence reference in `/admin/watch`.

Supported stream types:

- **MP4**: ordinary HTTPS MP4 video; supported by modern HTML5 browsers when the codec is supported.
- **HLS**: HTTPS `.m3u8` manifest. The player uses HLS.js for browsers with Media Source Extensions and native playback where the browser supports it. The media host must send CORS headers that permit the Storyverse X site to fetch the manifest and segments.

DRM-protected content from Netflix, Crunchyroll, Prime Video, or another subscription platform must remain on that platform. Do not copy, proxy, decrypt, scrape, or embed protected streams. Add an official provider link instead.

The publish form requires a rights confirmation. The database also enforces it: only episodes with `license_confirmed = true`, a rights-holder record, a secure stream URL and `is_published = true` are returned to public users.

## Watch progress and privacy

Signed-in members' positions are stored per user and episode in `watch_progress`. The player saves approximately every 15 seconds and when playback pauses or ends. The progress table is protected by row-level security; a member can read and update only their own rows. Signed-out visitors may play public licensed episodes but their progress is not synced.

## Deployment

After applying the migration and adding an admin account:

1. Add this updated project to the Git repository connected to Netlify.
2. Confirm Netlify Production variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SITE_URL` are correct. Never add `DATABASE_URL` or a service-role key to the website.
3. Trigger a fresh deploy. The Content Security Policy allows HTTPS media and HLS segment requests while keeping the rest of the data API server-side.
4. Open an anime title and test both an official provider link and a licensed source that you control.

A player shell can be deployed before any video sources are entered. It will show an empty state until a licensed episode is published; that is intentional.
