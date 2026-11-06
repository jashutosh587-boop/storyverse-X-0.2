'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

interface Suggestion {
  slug: string;
  title: string;
  media_type: string;
  release_year: number | null;
}

const LABEL: Record<string, string> = {
  anime: 'Anime',
  movie: 'Movie',
  tv: 'TV series',
  book: 'Book',
  novel: 'Novel',
  manga: 'Manga',
  comic: 'Comic',
};

/** Accept only well-formed suggestions; anything else from the network is ignored. */
function readSuggestions(data: unknown): Suggestion[] {
  if (!Array.isArray(data)) return [];
  const out: Suggestion[] = [];
  for (const row of data) {
    if (row && typeof row === 'object' && typeof row.slug === 'string' && typeof row.title === 'string') {
      out.push({
        slug: row.slug,
        title: row.title,
        media_type: typeof row.media_type === 'string' ? row.media_type : '',
        release_year: typeof row.release_year === 'number' ? row.release_year : null,
      });
    }
  }
  return out.slice(0, 8);
}

/**
 * A search form that works without JavaScript (it submits to /search). With
 * JavaScript it also offers title suggestions as you type, following the ARIA
 * combobox pattern: arrow keys move through the list, Enter opens the choice.
 */
export function SearchBox({
  initialQuery = '',
  large = false,
  autoFocus = false,
}: {
  initialQuery?: string;
  large?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(initialQuery);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setItems(response.ok ? readSuggestions(await response.json()) : []);
        setActive(-1);
      } catch {
        // Aborted or offline: the plain search form still works.
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const showList = open && items.length > 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (event.key === 'ArrowUp' && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === 'Enter' && showList && active >= 0) {
      event.preventDefault();
      setOpen(false);
      router.push(`/title/${items[active]!.slug}`);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form action="/search" role="search" className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <label htmlFor={`${listId}-input`} className="sr-only">
            Search titles
          </label>
          <input
            id={`${listId}-input`}
            name="q"
            type="search"
            value={value}
            autoFocus={autoFocus}
            autoComplete="off"
            maxLength={200}
            placeholder="Search anime, film, TV, books, novels and manga"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              clearTimeout(closeTimer.current);
              setOpen(true);
            }}
            onBlur={() => {
              closeTimer.current = setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={onKeyDown}
            className={`field ${large ? 'min-h-14 text-lg' : ''}`}
          />
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggested titles"
            hidden={!showList}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line-strong bg-raised"
          >
            {items.map((item, index) => (
              // An option is not a link: the ARIA pattern forbids interactive content inside one. Choosing it navigates in script.
              <li
                key={item.slug}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()} // keep focus in the field so the list is still there when the click lands
                onClick={() => {
                  setOpen(false);
                  router.push(`/title/${item.slug}`);
                }}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 ${index === active ? 'bg-surface' : 'hover:bg-surface'}`}
              >
                <span className="truncate">{item.title}</span>
                <span className="shrink-0 text-sm text-muted">
                  {LABEL[item.media_type] ?? item.media_type}
                  {item.release_year ? `, ${item.release_year}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button type="submit" className={`btn btn-primary ${large ? 'min-h-14 px-6' : ''}`}>
          Search
        </button>
      </div>
    </form>
  );
}
