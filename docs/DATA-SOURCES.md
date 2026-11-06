# Data sources

Every title on the site comes from an outside provider. This page says what each provider is, what its terms say as far as I could read them, what the site must show, and what you need to run an import. **Nothing here is legal advice, and nothing here has been tested against the live providers**: the environment this was built in could not reach them.

Checked on 3 November 2026. Providers change their terms and limits; check the pages named below again before you depend on any of this.

## Summary

| Provider | Used for | Credentials | Commercial use | Status |
| --- | --- | --- | --- | --- |
| **Jikan** (reads MyAnimeList) | anime, manga | none | **Unknown.** MyAnimeList's terms could not be read. | Adapter built and tested on fixtures; never run live. |
| **TMDB** | movies, TV | a read access token | **Needs a commercial licence** for a product whose primary purpose is revenue. | Adapter built and tested on fixtures; blocked until a token is provided; never run live. |
| **Open Library** | books | none, but identify yourself | Not addressed on the page I read. Asks not to be used for bulk downloads. | Adapter built and tested on fixtures; never run live. |

Novels (light novels, web novels), comics (manhwa, manhua, webtoons, Western comics), games, characters, voice actors, soundtracks and airing schedules have **no provider** yet. The "Novels" page exists and is empty.

## What a hobby project can do and what a business cannot

You asked, at the start, about earning money. The honest reading of the above is:

- You can build, run and show this as a personal or portfolio project today, with credit lines, using the free tiers.
- Charging for it, showing ads, or running a subscription changes TMDB's answer from "free" to "talk to their sales team", and moves the MyAnimeList question from academic to urgent.
- A product that earns money should plan for licensed or self-created data from the start. The cheapest legitimate sources are public-domain and openly licensed catalogs, data your own members contribute (their ratings, lists and reviews are yours to use under your own terms), and providers whose terms allow commercial use.

## Jikan (MyAnimeList)

- **What it is.** An unofficial REST API (`https://api.jikan.moe/v4`). Its README says it "scrapes the website to satisfy the need for API functionality that MyAnimeList.net lacks", that "Jikan is not affiliated with MyAnimeList.net", and "You are responsible for the usage of this API. Please be respectful towards MyAnimeList's Terms Of Service."
- **Terms.** MyAnimeList's terms of use are the ones that apply to the data. The page refuses automated readers, so I did not read it, and I could not find a statement about commercial use anywhere I could read. Treat commercial reuse as **not permitted until you have read the terms yourself or asked MyAnimeList**.
- **Rate limits.** Not found in any page I could read. The importer waits at least 1.1 seconds between requests (under 1 per second), which is below the 3 per second and 60 per minute I expected from memory but could not confirm. When a provider answers `429` (or a temporary server error) the client waits, honouring `Retry-After`, and retries up to four times. If it still fails, a failed item (for example TMDB's detail request for one title) is recorded in `ingestion_errors` and skipped, and a failed list page stops the run with status `failed`, so `--resume` continues from that page.
- **Shown on the site.** Each title page lists "MyAnimeList (through the Jikan API)" with the fetch date and a link to the MyAnimeList page; the About page lists totals per source. Scores are labelled "Score on MyAnimeList" and are never mixed with members' ratings.
- **Needs:** nothing. `INGEST_CONTACT` is still sent in the `User-Agent`.

## TMDB (The Movie Database)

Source: TMDB's developer FAQ, `https://developer.themoviedb.org/docs/faq`, and the rate limiting page, `https://developer.themoviedb.org/docs/rate-limiting`. TMDB's separate API terms of use page refuses automated readers and was **not** read.

- **Commercial use.** "Our API is free to use for non-commercial purposes as long as you attribute TMDB as the source of the data and/or images." "Your project is considered commercial if the primary purpose is to create revenue for the benefit of the owner." For a commercial licence the FAQ points to TMDB's sales team (`https://www.themoviedb.org/api-for-business`).
- **Attribution.** The notice to show is "This product uses the TMDB API but is not endorsed or certified by TMDB." and it "must be within your application's 'About' or 'Credits' type section". The site shows it on the About page and on every title page that has TMDB data. If you use a TMDB logo it must be one of the approved logos (`https://www.themoviedb.org/about/logos-attribution`) and less prominent than your own mark. **No logo is bundled**; add one only from that page. Name TMDB only as "TMDB" or "The Movie Database".
- **Rate limits.** The page says limits "sit somewhere in the 40 requests per second range" and "could change at any time", and to respect a `429`. The importer waits at least 150 ms between requests (under 7 per second).
- **Credentials.** A read access token (`TMDB_READ_ACCESS_TOKEN`), created in your TMDB account's API settings. Without it `npm run ingest -- tmdb ...` stops immediately and says what is missing; the site never shows movie or TV data it does not have.
- **Images.** See "Artwork" below.

## Open Library

Source: `https://openlibrary.org/developers/api`.

- **Identification.** The page asks applications to "Identify your application with a `User-Agent` header and `email`" and says "identified requests will enjoy a 3x request limit": 1 request per second unidentified, 3 per second identified. The importer sends a `User-Agent` with `INGEST_CONTACT` and waits at least 0.4 seconds between requests (2.5 per second).
- **Bulk use.** "Please do not use our APIs to bulk download metadata because this impacts our ability to serve patrons." "We make our data publicly available each month for partners." The importer's `openlibrary` command pages through search results, which is the kind of use that sentence is about when done at scale. Keep imports small (a subject at a time), and for a large book catalog use their monthly data dumps instead. **Dump import is not built.**
- **Covers.** Cover images are linked from `covers.openlibrary.org`, not copied. I did not find limits for the covers API on the page I read, and I did not verify how cover URLs behave when a cover does not exist. (The site links a cover only when Open Library lists a cover id for the book; a link that then fails to load would show an empty frame.)
- **Needs:** nothing but a real `INGEST_CONTACT`.

## Artwork

Posters and covers belong to the providers or to their rights holders. The database stores only each image's URL. At display time the site's Next.js image optimizer fetches the image from the provider's host (`cdn.myanimelist.net`, `image.tmdb.org`, `covers.openlibrary.org` are the only hosts it will accept) and keeps resized copies in a cache on the server. I could not check whether that caching is within each provider's terms for artwork (TMDB's terms page refuses automated readers, and I read nothing about artwork for the other two). If a provider's terms forbid it, serve that provider's images directly instead of through the optimizer, which also means changing the Content-Security-Policy's `img-src` in `src/lib/csp.ts`. When a title has no artwork URL, or one from another host, the site shows a placeholder with the title's initials. An image whose URL exists but fails to load shows an empty frame; there is no fallback for that yet.

## What the site shows for sources

- Title pages end with a Sources section: provider, a link to the original record, the date it was fetched, and the provider's attribution text.
- `/about` ("Data sources and scores") lists each provider with the number of titles and the last fetch date, plus the TMDB notice when TMDB data is present, and explains how scores and rankings are computed.
- The footer says the site is independent and not affiliated with MyAnimeList, TMDB or Open Library.

## Credentials and external dependencies, in one list

| Needed for | What | Where it goes | Provided? |
| --- | --- | --- | --- |
| Running the site | a Supabase project's URL and anon key | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no |
| Running the site | the public address | `SITE_URL` | no |
| Importing anything | a direct or session-pooler Postgres connection | `DATABASE_URL` | no |
| Importing anything | a contact address for providers | `INGEST_CONTACT` | no |
| Movies and TV | a TMDB read access token (and a commercial licence if you earn money) | `TMDB_READ_ACCESS_TOKEN` | no |
| Production email | an SMTP provider for Supabase Auth | Supabase dashboard | no |
| Scheduled imports | the three import secrets as repository secrets | GitHub Actions secrets | no |
| Everything in the specification that is still planned | an LLM provider (Story AI), a payment provider (subscriptions), an error tracker, a search or vector service if you outgrow Postgres | not wired | no |

None of these exist in this repository, and nothing pretends they do.
