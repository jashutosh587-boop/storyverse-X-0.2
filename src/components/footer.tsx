import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="shell flex flex-col gap-4 py-10 text-sm text-muted md:flex-row md:items-start md:justify-between">
        <p className="max-w-xl">
          Storyverse X is an independent project. It is not affiliated with MyAnimeList, TMDB or Open Library, whose data it shows
          with credit on the data sources page.
        </p>
        <nav aria-label="Site" className="flex gap-5">
          <Link href="/about" className="hover:text-text">
            Data sources and scores
          </Link>
          <Link href="/search" className="hover:text-text">
            Search
          </Link>
        </nav>
      </div>
    </footer>
  );
}
