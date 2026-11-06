# Import anime into Storyverse X

This project already includes the Jikan adapter and the ingestion pipeline. The live catalog is empty because the import job has not yet written anime records. The import is separate from the public website: **do not put `DATABASE_URL` in Netlify or in browser code**.

## Windows quick start

1. Install Node.js 20.9 or newer.
2. Extract this project ZIP and open PowerShell in the `storyverse-x` project folder.
3. Install dependencies:

   ```powershell
   npm ci
   ```

4. Run the guided importer:

   ```powershell
   .\scripts\import-anime.ps1 -Pages 2
   ```

5. When prompted, paste the PostgreSQL **Session pooler** connection string from Supabase Dashboard → Connect. The password is entered as a secure prompt and kept only in the current PowerShell process. It is not written into the project.
6. The script performs a dry run first. If it succeeds, type `IMPORT` when prompted to insert the records.
7. Refresh `https://stellular-sunflower-e383b4.netlify.app/anime`.

`-Pages 2` imports up to 50 popular anime. To import more, use e.g. `-Pages 10` (up to 250). Start small and increase gradually; Jikan has request-rate limits and the importer deliberately waits between page requests.

## Connection string

Use the **Session pooler** connection string from Supabase's Connect panel (port 5432). Do not use transaction pooler mode (port 6543) for this importer. A direct database connection may not work on IPv4-only networks.

The connection string contains the database password. Do not paste it into ChatGPT, commit it to GitHub, add it to Netlify, or put it in frontend environment variables. If it has ever been exposed, rotate the database password in Supabase.

## Verify the import

Run this in Supabase SQL Editor:

```sql
select media_type, count(*) as total
from public.titles
group by media_type
order by media_type;

select provider, count(*) as total
from public.title_sources
group by provider
order by provider;

select provider, job, status, items_seen, items_inserted, items_updated,
       items_unchanged, items_failed, started_at
from public.ingestion_runs
order by started_at desc
limit 10;
```

For anime, expect `media_type = 'anime'` and `provider = 'jikan'`. If the run is partial or failed, inspect:

```sql
select external_id, message, created_at
from public.ingestion_errors
order by created_at desc
limit 20;
```

The app's existing public `SELECT` policies are sufficient for the website to read imported catalog titles. Do not disable RLS or grant anonymous write access.

## Data-source note

Jikan is an unofficial API providing MyAnimeList data. Review `docs/DATA-SOURCES.md` and the relevant provider terms before monetizing or redistributing data. The importer stores provider attribution and source links.
