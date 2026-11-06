'use client';

import Image from 'next/image';
import { useCallback, useState, type ReactNode } from 'react';

/**
 * The artwork itself. When a provider's image cannot be loaded (the file was
 * removed, the address changed, the provider is down) it is swapped for
 * `fallback`, the same placeholder a title without artwork gets, instead of
 * leaving a broken-image icon in an empty frame.
 */
export function PosterImage({ src, sizes, priority, fallback }: { src: string; sizes: string; priority: boolean; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  // A load that already failed before this component hydrated will not fire onError for React, so look once when it mounts.
  const watch = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <>{fallback}</>;
  return <Image ref={watch} src={src} alt="" fill sizes={sizes} priority={priority} className="object-cover" onError={() => setFailed(true)} />;
}
