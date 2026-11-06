import Link from 'next/link';

/** Previous and next links between pages of results. `hrefFor` builds the link for a page number. */
export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pages of results" className="mt-10 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className="btn btn-quiet">
          Previous
        </Link>
      ) : (
        <span className="btn btn-quiet" aria-disabled="true">
          Previous
        </span>
      )}
      <p className="tnum text-sm text-muted">
        Page {page} of {totalPages}
      </p>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} rel="next" className="btn btn-quiet">
          Next
        </Link>
      ) : (
        <span className="btn btn-quiet" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
