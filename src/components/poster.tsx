import { initialsOf, MEDIA_LABEL } from '@/lib/format';
import { isAllowedImage } from '@/lib/image-hosts';
import type { MediaType } from '@/lib/providers/types';
import { PosterImage } from './poster-image';

/**
 * A 2:3 cover. When a title has no artwork from its provider, or the artwork
 * cannot be loaded, this shows its initials and medium: a plain placeholder,
 * never an invented image.
 */
export function Poster({
  title,
  url,
  mediaType,
  sizes,
  priority = false,
}: {
  title: string;
  url: string | null | undefined;
  mediaType: MediaType;
  sizes: string;
  priority?: boolean;
}) {
  const placeholder = (
    <div aria-hidden="true" className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
      <span className="display text-4xl text-violet-soft">{initialsOf(title)}</span>
      <span className="text-xs text-muted">{MEDIA_LABEL[mediaType]}</span>
    </div>
  );

  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-poster border border-line bg-raised">
      {isAllowedImage(url) ? <PosterImage key={url} src={url} sizes={sizes} priority={priority} fallback={placeholder} /> : placeholder}
    </div>
  );
}
