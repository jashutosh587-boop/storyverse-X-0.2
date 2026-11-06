import Link from 'next/link';
import { SearchBox } from '@/components/search-box';
import { CATEGORIES } from '@/lib/categories';

export default function NotFound() {
  return (
    <div className="shell py-16">
      <h1 className="display text-5xl md:text-6xl">That page is not here</h1>
      <p className="mt-3 max-w-xl text-lg text-muted">
        The link may be old or mistyped, or the title may not be in the catalog. Search for what you were after, or pick a category.
      </p>
      <div className="mt-8 max-w-2xl">
        <SearchBox />
      </div>
      <ul aria-label="Categories" className="mt-6 flex flex-wrap gap-2">
        {CATEGORIES.map((category) => (
          <li key={category.slug}>
            <Link href={`/${category.slug}`} className="chip">
              {category.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
