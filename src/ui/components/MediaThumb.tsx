import { useEffect, useMemo, useState } from 'react';
import { api, type MediaRow } from '../api';

// Presigned read URLs (GET /api/media/:id/url, 1h expiry) resolved once per
// session and cached; a failed lookup (404 foreign media, 503 storage not
// configured, network) caches as unavailable so the tile fallback stays stable.
const cache = new Map<string, Promise<string | null>>();

export function mediaUrl(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = api<{ url: string }>(`/api/media/${encodeURIComponent(id)}/url`)
      .then((r) => r.url)
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export function useMediaUrls(ids: Array<string | null | undefined>): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = ids.map((x) => x ?? '').join('|');
  const wanted = useMemo(
    () => [...new Set(key.split('|').filter((x) => x !== ''))],
    [key],
  );
  useEffect(() => {
    if (wanted.length === 0) return;
    let alive = true;
    void Promise.all(wanted.map(async (id) => [id, await mediaUrl(id)] as const)).then((pairs) => {
      if (!alive) return;
      setUrls((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [id, url] of pairs) {
          if (url && next[id] !== url) {
            next[id] = url;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => { alive = false; };
  }, [wanted]);
  return urls;
}

// Thumbnail for a persisted media row; images load via the presigned URL,
// anything else (or a failed lookup) renders the generic tile.
export function MediaThumb({ media, className }: { media?: MediaRow; className?: string }) {
  const urls = useMediaUrls([media?.id]);
  if (!media) return null;
  const url = media.id ? urls[media.id] : undefined;
  return (
    <div className={`thumb${className ? ` ${className}` : ''}`}>
      {url && media.mime.startsWith('image/')
        ? <img src={url} alt="" />
        : <span className="thumb-file">{media.mime.startsWith('video/') ? 'video' : 'media'}</span>}
    </div>
  );
}
