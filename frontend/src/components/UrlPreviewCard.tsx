import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UrlPreview } from '../types';

// Lazily fetches an OpenGraph preview for a URL when mounted. Renders nothing on
// failure or when there is no usable metadata (the plain link remains in text).
export function UrlPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    api
      .unfurl(url, controller.signal)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch(() => {
        if (active) setPreview(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);

  if (loading) {
    return (
      <span className="mt-1 block h-12 max-w-sm rounded border border-border bg-muted/30 animate-pulse" />
    );
  }
  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex max-w-sm gap-2 overflow-hidden rounded-md border border-border bg-background/50 p-2 no-underline hover:bg-accent"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="h-14 w-14 flex-shrink-0 rounded object-cover"
        />
      )}
      <span className="flex min-w-0 flex-col">
        {preview.site_name && (
          <span className="truncate text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            {preview.site_name}
          </span>
        )}
        {preview.title && (
          <span className="truncate font-medium leading-tight">{preview.title}</span>
        )}
        {preview.description && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</span>
        )}
      </span>
    </a>
  );
}
